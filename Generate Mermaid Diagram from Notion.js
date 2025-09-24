// Build Mermaid OTIMIZADO - VERSÃO COM AGRUPAMENTO POR HB COMPARTILHADOS
export async function buildWinningHypothesesMermaid({
  startWinningId, // Nome do database
  propertyNames = {
    wh_to_hb: "All Hypotheses Backlog",
    hb_to_vr: "Validation Roadmap",
    vr_to_l: "Learnings",
    l_to_hb: "New Hypotheses"
  },
  dbTitles = {
    wh: "Winning Hypotheses",
    hb: "Hypothesis Backlog",
    vr: "Validation Roadmap",
    l: "BML Learnings"
  },
  maxWinning = 500,
  maxDepth = 10,
  emitStyles = true,
  insert
}: {
  startWinningId: string;
  propertyNames?: {
    wh_to_hb: string;
    hb_to_vr: string;
    vr_to_l?: string;
    l_to_hb?: string;
  };
  dbTitles?: {
    wh: string;
    hb: string;
    vr: string;
    l?: string;
  };
  maxWinning?: number;
  maxDepth?: number;
  emitStyles?: boolean;
  insert?: {
    targetPageId: string;
    tagName: string
  };
}): Promise<{
  mermaid: string;
  counts: {
    winning: number;
    backlogs: number;
    validations: number;
    learnings: number;
  };
  debug: string[];
  inserted?: boolean;
  deleteCount?: number;
}> {
  const H = { "Notion-Version": "2022-06-28", "Content-Type": "application/json" } as Record<string,string>;
  const debug: string[] = [];
  const sanitizeId = (s?: string) => String(s || "").trim();

  async function http(url: string, init: RequestInit, label?: string) {
    const res = await fetchWithZapier(url, init);
    if (res.status >= 400) {
      const txt = await res.text().catch(()=>"");
      debug.push(`HTTP ${init.method||"GET"} ${label||url} -> ${res.status} ${res.statusText} | ${txt}`);
    }
    await res.throwErrorIfNotOk?.();
    return res;
  }

  // Buscar database ID pelo nome
  async function getDatabaseIdByName(dbName: string): Promise<string | null> {
    debug.push(`Searching for database named: ${dbName}`);
    
    const body = {
      query: dbName,
      filter: {
        value: "database",
        property: "object"
      }
    };
    
    try {
      const res = await http(
        'https://api.notion.com/v1/search',
        {
          method: "POST",
          headers: H,
          body: JSON.stringify(body)
        },
        `Search for database ${dbName}`
      );
      
      const data = await res.json();
      
      if (Array.isArray(data?.results)) {
        for (const result of data.results) {
          if (result.object === 'database') {
            const props = result?.title || [];
            const title = props.map((x: any) => x?.plain_text ?? x?.text?.content ?? "").join("").trim();
            
            debug.push(`Found database candidate: "${title}" (ID: ${result.id})`);
            
            if (title.toLowerCase() === dbName.toLowerCase()) {
              debug.push(`✓ Matched database: ${result.id}`);
              return result.id;
            }
          }
        }
        debug.push(`No exact match found for database name: ${dbName}`);
      }
    } catch (err) {
      debug.push(`Error searching for database: ${err}`);
    }
    
    return null;
  }

  // Buscar todas as páginas de um database com ordenação
  async function getAllPagesFromDatabase(dbId: string): Promise<string[]> {
    debug.push(`Fetching all pages from database: ${dbId}`);
    
    const pageIds: string[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    
    while (hasMore && pageIds.length < maxWinning) {
      const body: any = {
        page_size: 100,
        sorts: [{
          timestamp: "created_time",
          direction: "ascending"
        }]
      };
      
      if (cursor) {
        body.start_cursor = cursor;
      }
      
      try {
        const res = await http(
          `https://api.notion.com/v1/databases/${encodeURIComponent(dbId)}/query`,
          {
            method: "POST",
            headers: H,
            body: JSON.stringify(body)
          },
          `Query database ${dbId}`
        );
        
        const data = await res.json();
        
        if (Array.isArray(data?.results)) {
          const ids = data.results.map((page: any) => page.id).filter(Boolean);
          pageIds.push(...ids);
          
          hasMore = !!data.has_more && pageIds.length < maxWinning;
          cursor = data.next_cursor || undefined;
          
          debug.push(`Found ${ids.length} pages, total so far: ${pageIds.length}`);
        } else {
          hasMore = false;
        }
      } catch (err) {
        debug.push(`Error querying database: ${err}`);
        hasMore = false;
      }
    }
    
    if (pageIds.length > maxWinning) {
      pageIds.length = maxWinning;
      debug.push(`Limited to ${maxWinning} pages`);
    }
    
    debug.push(`Total pages to process: ${pageIds.length}`);
    return pageIds;
  }

  // Buscar múltiplas páginas em paralelo
  async function getPagesInBatch(pageIds: string[]): Promise<Map<string, any>> {
    const uniqueIds = [...new Set(pageIds.filter(id => id && !pageCache.has(id)))];
    if (!uniqueIds.length) return pageCache;
    
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      batches.push(uniqueIds.slice(i, i + BATCH_SIZE));
    }
    
    for (const batch of batches) {
      const promises = batch.map(async (pageId) => {
        try {
          const res = await http(
            `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
            { method: "GET", headers: H },
            `GET /pages/${pageId}`
          );
          const page = await res.json();
          return { id: pageId, page };
        } catch (err) {
          debug.push(`Error fetching page ${pageId}: ${err}`);
          return { id: pageId, page: null };
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(({ id, page }) => {
        if (page) pageCache.set(id, page);
      });
    }
    
    return pageCache;
  }

  // Buscar propriedades em paralelo
  async function getRelationsBatch(pageRelationSpecs: Array<{
    pageId: string;
    propName: string;
    page?: any;
  }>): Promise<Map<string, string[]>> {
    const results = new Map<string, string[]>();
    
    const promises = pageRelationSpecs.map(async ({ pageId, propName, page }) => {
      try {
        const actualPage = page || pageCache.get(pageId);
        if (!actualPage) return { key: `${pageId}:${propName}`, ids: [] };
        
        const propId = getPropertyIdByName(actualPage, propName);
        if (!propId) {
          if (propName !== propertyNames.vr_to_l && propName !== propertyNames.l_to_hb) {
            debug.push(`Property "${propName}" not found on page ${pageId}`);
          }
          return { key: `${pageId}:${propName}`, ids: [] };
        }
        
        const ids = await listAllRelationTargets(pageId, propId);
        return { key: `${pageId}:${propName}`, ids };
      } catch (err) {
        debug.push(`Error getting relations for ${pageId}:${propName}: ${err}`);
        return { key: `${pageId}:${propName}`, ids: [] };
      }
    });
    
    const relResults = await Promise.all(promises);
    relResults.forEach(({ key, ids }) => results.set(key, ids));
    return results;
  }

  function getTitleFromPage(page: any): string {
    const props = page?.properties || {};
    for (const [name, p] of Object.entries<any>(props)) {
      if (p?.type === "title") {
        const arr = p?.title || [];
        const txt = arr.map((x: any) => x?.plain_text ?? x?.text?.content ?? "").join("").trim();
        return txt || name;
      }
    }
    return page?.id || "Untitled";
  }

  function getTextProperty(page: any, propName: string): string {
    const props = page?.properties || {};
    const prop = props[propName];
    if (!prop) return "";
    
    if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) {
      return prop.rich_text
        .map((x: any) => x?.plain_text ?? x?.text?.content ?? "")
        .join("")
        .trim();
    }
    
    if (prop.type === "title" && Array.isArray(prop.title)) {
      return prop.title
        .map((x: any) => x?.plain_text ?? x?.text?.content ?? "")
        .join("")
        .trim();
    }
    
    if (prop.type === "select" && prop.select) {
      return prop.select.name || "";
    }
    
    return "";
  }

  function sanitizeForMermaid(text: string): string {
    if (!text) return "";
    return text
      .replace(/[\r\n]+/g, " ")
      .replace(/['"]/g, "'")
      .replace(/[`]/g, "'")
      .replace(/[{}]/g, "")
      .replace(/[\[\]]/g, "")
      .replace(/[|]/g, "-")
      .replace(/[;]/g, ",")
      .replace(/[&]/g, "and")
      .replace(/\\/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function createEnrichedLabel(nodeType: string, page: any): string {
    const title = sanitizeForMermaid(getTitleFromPage(page));
    const parts = [`<b>${title}</b>`];
    
    if (nodeType === "WH") {
      const description = sanitizeForMermaid(getTextProperty(page, "Description"));
      if (description) {
        parts.push(`<p> </p><i>${description}</i>`);
      }
    } else if (nodeType === "HB") {
      const description = sanitizeForMermaid(getTextProperty(page, "Description"));
      if (description) {
        parts.push(`<p> </p><b>Description:</b> <i>${description}</i>`);
      }
    } else if (nodeType === "VR") {
      const goal = sanitizeForMermaid(getTextProperty(page, "Goal"));
      const summary = sanitizeForMermaid(getTextProperty(page, "Summary"));
      if (goal) {
        parts.push(`<p> </p><b>Goal:</b> <i>${goal}</i>`);
      }
      if (summary) {
        parts.push(`<p> </p><b>Description:</b> <i>${summary}</i>`);
      }
    } else if (nodeType === "L") {
      const positives = sanitizeForMermaid(getTextProperty(page, "Positives Summary"));
      const negatives = sanitizeForMermaid(getTextProperty(page, "Negatives Summary"));
      if (positives) {
        parts.push(`<p> </p><b>Positives:</b> <i>${positives}</i>`);
      }
      if (negatives) {
        parts.push(`<p> </p><b>Negatives:</b> <i>${negatives}</i>`);
      }
    }
    
    return parts.join("");
  }

  function getPropertyIdByName(page: any, propName: string): string | null {
    const props = page?.properties || {};
    if (!props[propName]) return null;
    const p = props[propName];
    if (p?.type !== "relation" && p?.type !== "rollup") {
      debug.push(`Property "${propName}" type is "${p?.type}" (expected relation/rollup).`);
    }
    return p?.id ?? null;
  }

  async function listAllRelationTargets(pageIdRaw: string, propIdRaw: string): Promise<string[]> {
    const pageId = sanitizeId(pageIdRaw), propId = sanitizeId(propIdRaw);
    if (!pageId || !propId) return [];
    
    const base = `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propId)}`;
    let results: string[] = [], cursor: string|undefined, more = true;
    
    while (more) {
      const url = cursor ? `${base}?start_cursor=${encodeURIComponent(cursor)}` : base;
      const res = await http(url, { method: "GET", headers: H });
      const data = await res.json();
      
      if (Array.isArray(data?.results)) {
        const chunk = data.results.map((it: any) => it?.relation?.id).filter(Boolean);
        results.push(...chunk);
        more = !!data?.has_more;
        cursor = data?.next_cursor || undefined;
      } else if (data?.type === "rollup" && data?.rollup?.type === "array") {
        const arr = data.rollup.array || [];
        const chunk = arr.map((x: any) => x?.relation?.id).filter(Boolean);
        results.push(...chunk);
        more = false;
      } else {
        more = false;
      }
    }
    
    return results;
  }

  const esc = (s: string) => {
    return String(s || "")
      .replace(/"/g, "'")
      .replace(/&(?!(lt|gt|amp);)/g, "&amp;");
  };

  const typeOfId = (id: string) =>
    id.startsWith("WH_") ? "WH" :
    id.startsWith("HB_") ? "HB" :
    id.startsWith("VR_") ? "VR" :
    id.startsWith("L_") ? "L" :
    "VR";

  const labelWithPrefix = (id: string, label: string) => {
    const t = typeOfId(id);
    let pfx = "";
    if (t === "WH") pfx = "<b>WH:</b>";
    else if (t === "HB") pfx = "<b>HB:</b>";
    else if (t === "VR") pfx = "<b>VR:</b>";
    else if (t === "L") pfx = "<b>BML:</b>";
    else pfx = "<b>VR:</b>";
    
    if (label.startsWith("<b>")) {
      return label.replace(/^<b>/, `${pfx} <b>`);
    } else {
      return `${pfx} ${label}`;
    }
  };

  const mid = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;

  // Estruturas principais
  const pageCache = new Map<string,any>();
  const nodeLabels = new Map<string,string>();
  const edgeSet = new Set<string>();
  const addEdge = (a: string, b: string) => edgeSet.add(`${a} --> ${b}`);
  
  const processedHB = new Set<string>();
  const processedVR = new Set<string>();
  const processedL = new Set<string>();
  
  let whCount = 0, hbCount = 0, vrCount = 0, lCount = 0;

  // NOVA FUNÇÃO: Agrupar WH por HB compartilhados
  function groupWHBySharedHB(
    whPages: string[], 
    whRelations: Map<string, string[]>
  ): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();
    
    whPages.forEach(whId => {
      if (processed.has(whId)) return;
      
      const group = [whId];
      processed.add(whId);
      
      const whHBs = new Set(whRelations.get(`${whId}:${propertyNames.wh_to_hb}`) || []);
      
      // Encontrar outros WH que compartilham HB
      whPages.forEach(otherId => {
        if (otherId === whId || processed.has(otherId)) return;
        
        const otherHBs = whRelations.get(`${otherId}:${propertyNames.wh_to_hb}`) || [];
        const hasSharedHB = otherHBs.some(hb => whHBs.has(hb));
        
        if (hasSharedHB) {
          group.push(otherId);
          processed.add(otherId);
          // Adicionar os HBs do outro WH ao conjunto para encontrar mais relacionados
          otherHBs.forEach(hb => whHBs.add(hb));
        }
      });
      
      groups.push(group);
    });
    
    // Ordenar grupos: maiores primeiro, depois por primeiro ID para consistência
    groups.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a[0].localeCompare(b[0]);
    });
    
    return groups;
  }

  // FUNÇÃO RECURSIVA (mantida igual)
  async function processHBRecursively(
    hbIds: string[],
    parentNodes: Map<string, string>,
    depth: number = 0
  ): Promise<void> {
    if (!hbIds.length || depth >= maxDepth) return;
    
    const newHbIds = hbIds.filter(id => !processedHB.has(id));
    if (!newHbIds.length) return;
    
    newHbIds.forEach(id => processedHB.add(id));
    await getPagesInBatch(newHbIds);
    
    const hbRelSpecs: any[] = [];
    const hbNodeMap = new Map<string, string>();
    
    newHbIds.forEach(hbId => {
      const hbPage = pageCache.get(hbId);
      if (!hbPage) return;
      
      const hbLabel = createEnrichedLabel("HB", hbPage);
      const hbNode = mid("HB", hbId);
      
      if (!nodeLabels.has(hbNode)) {
        nodeLabels.set(hbNode, hbLabel);
        hbCount++;
      }
      
      hbNodeMap.set(hbId, hbNode);
      
      const parentNode = parentNodes.get(hbId);
      if (parentNode) {
        addEdge(parentNode, hbNode);
      }
      
      hbRelSpecs.push({ pageId: hbId, propName: propertyNames.hb_to_vr, page: hbPage });
    });
    
    const hbRelations = await getRelationsBatch(hbRelSpecs);
    
    const vrIds: string[] = [];
    const vrParentMap = new Map<string, string>();
    
    newHbIds.forEach(hbId => {
      const vrs = hbRelations.get(`${hbId}:${propertyNames.hb_to_vr}`) || [];
      const hbNode = hbNodeMap.get(hbId);
      if (hbNode) {
        vrs.forEach(vrId => {
          if (!processedVR.has(vrId)) {
            vrIds.push(vrId);
            vrParentMap.set(vrId, hbNode);
          }
        });
      }
    });
    
    if (!vrIds.length) return;
    
    vrIds.forEach(id => processedVR.add(id));
    await getPagesInBatch(vrIds);
    
    const vrRelSpecs: any[] = [];
    const vrNodeMap = new Map<string, string>();
    
    vrIds.forEach(vrId => {
      const vrPage = pageCache.get(vrId);
      if (!vrPage) return;
      
      const vrLabel = createEnrichedLabel("VR", vrPage);
      const vrNode = mid("VR", vrId);
      
      if (!nodeLabels.has(vrNode)) {
        nodeLabels.set(vrNode, vrLabel);
        vrCount++;
      }
      
      vrNodeMap.set(vrId, vrNode);
      
      const hbNode = vrParentMap.get(vrId);
      if (hbNode) {
        addEdge(hbNode, vrNode);
      }
      
      if (propertyNames.vr_to_l) {
        vrRelSpecs.push({ pageId: vrId, propName: propertyNames.vr_to_l, page: vrPage });
      }
    });
    
    if (!propertyNames.vr_to_l || !vrRelSpecs.length) return;
    
    const vrRelations = await getRelationsBatch(vrRelSpecs);
    
    const lIds: string[] = [];
    const lParentMap = new Map<string, string>();
    
    vrIds.forEach(vrId => {
      const ls = vrRelations.get(`${vrId}:${propertyNames.vr_to_l}`) || [];
      const vrNode = vrNodeMap.get(vrId);
      if (vrNode) {
        ls.forEach(lId => {
          if (!processedL.has(lId)) {
            lIds.push(lId);
            lParentMap.set(lId, vrNode);
          }
        });
      }
    });
    
    if (!lIds.length) return;
    
    lIds.forEach(id => processedL.add(id));
    await getPagesInBatch(lIds);
    
    const lRelSpecs: any[] = [];
    const lNodeMap = new Map<string, string>();
    
    lIds.forEach(lId => {
      const lPage = pageCache.get(lId);
      if (!lPage) return;
      
      const lLabel = createEnrichedLabel("L", lPage);
      const lNode = mid("L", lId);
      
      if (!nodeLabels.has(lNode)) {
        nodeLabels.set(lNode, lLabel);
        lCount++;
      }
      
      lNodeMap.set(lId, lNode);
      
      const vrNode = lParentMap.get(lId);
      if (vrNode) {
        addEdge(vrNode, lNode);
      }
      
      if (propertyNames.l_to_hb) {
        lRelSpecs.push({ pageId: lId, propName: propertyNames.l_to_hb, page: lPage });
      }
    });
    
    if (!propertyNames.l_to_hb || !lRelSpecs.length) return;
    
    const lRelations = await getRelationsBatch(lRelSpecs);
    
    const newHBIds: string[] = [];
    const newHBParentMap = new Map<string, string>();
    
    lIds.forEach(lId => {
      const hbs = lRelations.get(`${lId}:${propertyNames.l_to_hb}`) || [];
      const lNode = lNodeMap.get(lId);
      if (lNode) {
        hbs.forEach(hbId => {
          if (!processedHB.has(hbId)) {
            newHBIds.push(hbId);
            newHBParentMap.set(hbId, lNode);
          }
        });
      }
    });
    
    if (newHBIds.length) {
      await processHBRecursively(newHBIds, newHBParentMap, depth + 1);
    }
  }

  // PROCESSAMENTO PRINCIPAL COM AGRUPAMENTO
  const databaseName = sanitizeId(startWinningId);
  debug.push(`Starting process for database: "${databaseName}"`);
  
  // Buscar database ID pelo nome
  const dbId = await getDatabaseIdByName(databaseName);
  
  if (!dbId) {
    throw new Error(`Database "${databaseName}" not found. Please check the database name and ensure you have access to it.`);
  }
  
  // Buscar todas as páginas do database
  const allWHPages = await getAllPagesFromDatabase(dbId);
  
  if (!allWHPages.length) {
    throw new Error(`Database "${databaseName}" is empty or you don't have access to its pages.`);
  }
  
  debug.push(`Processing ${allWHPages.length} Winning Hypotheses from database`);
  
  // Buscar informações de todas as páginas WH
  await getPagesInBatch(allWHPages);
  
  // Primeiro, buscar todas as relações WH -> HB para agrupamento
  const whRelSpecs: any[] = [];
  
  allWHPages.forEach(whId => {
    const whPage = pageCache.get(whId);
    if (!whPage) return;
    whRelSpecs.push({ pageId: whId, propName: propertyNames.wh_to_hb, page: whPage });
  });
  
  const whRelations = await getRelationsBatch(whRelSpecs);
  
  // AGRUPAR WH POR HB COMPARTILHADOS
  const whGroups = groupWHBySharedHB(allWHPages, whRelations);
  debug.push(`Organized ${allWHPages.length} WH into ${whGroups.length} groups`);
  
  // Processar cada WH e criar nós
  allWHPages.forEach(whId => {
    const whPage = pageCache.get(whId);
    if (!whPage) return;
    
    const whLabel = createEnrichedLabel("WH", whPage);
    const whNode = mid("WH", whId);
    
    if (!nodeLabels.has(whNode)) {
      nodeLabels.set(whNode, whLabel);
      whCount++;
    }
  });
  
  // Adicionar conexões virtuais entre WH do mesmo grupo (opcional)
  // Isso cria uma linha pontilhada entre WH relacionados
  whGroups.forEach((group, groupIndex) => {
    if (group.length > 1) {
      debug.push(`Group ${groupIndex + 1}: ${group.length} related WH`);
      
      // Opção 1: Criar um nó virtual de grupo (comentado por padrão)
      /*
      const groupNode = `GROUP_${groupIndex}`;
      nodeLabels.set(groupNode, `<b>Related WH Group ${groupIndex + 1}</b>`);
      
      group.forEach(whId => {
        const whNode = mid("WH", whId);
        addEdge(groupNode, whNode);
      });
      */
      
      // Opção 2: Manter WH próximos visualmente (através da ordem de processamento)
      // Já está feito pelo agrupamento
    }
  });
  
  // Coletar todos os HBs mantendo a ordem dos grupos
  const hbIds: string[] = [];
  const hbParentMap = new Map<string, string>();
  
  // Processar grupos em ordem para manter WH relacionados próximos
  whGroups.forEach(group => {
    group.forEach(whId => {
      const whNode = mid("WH", whId);
      const hbs = whRelations.get(`${whId}:${propertyNames.wh_to_hb}`) || [];
      
      hbs.forEach(hbId => {
        // Evitar duplicatas mas manter a primeira ocorrência para ordem
        if (!hbParentMap.has(hbId)) {
          hbIds.push(hbId);
          hbParentMap.set(hbId, whNode);
        } else {
          // Se o HB já existe, adicionar edge adicional
          const existingParent = hbParentMap.get(hbId);
          if (existingParent !== whNode) {
            // Será adicionado edge adicional quando processar o HB
            const hbNode = mid("HB", hbId);
            addEdge(whNode, hbNode);
          }
        }
      });
    });
  });
  
  // Processar todos os HBs e suas cadeias recursivamente
  if (hbIds.length) {
    debug.push(`Found ${hbIds.length} unique Hypothesis Backlogs to process`);
    await processHBRecursively(hbIds, hbParentMap, 0);
  }

  // Gerar Mermaid
  const mm: string[] = [];
  mm.push("flowchart TD");
  
  if (emitStyles) {
    mm.push('classDef WH fill:#8b5cf6,color:#ffffff,stroke:#4c1d95,stroke-width:1.5,rx:10,ry:10;');
    mm.push('classDef HB fill:#3b82f6,color:#ffffff,stroke:#1e3a8a,stroke-width:1.5,rx:10,ry:10;');
    mm.push('classDef VR fill:#f59e0b,color:#111827,stroke:#9a3412,stroke-width:1.5,rx:10,ry:10;');
    mm.push('classDef L fill:#10b981,color:#ffffff,stroke:#064e3b,stroke-width:1.5,rx:10,ry:10;');
  }
  
  // Adicionar nós na ordem dos grupos para melhor visualização
  whGroups.forEach(group => {
    group.forEach(whId => {
      const whNode = mid("WH", whId);
      const label = nodeLabels.get(whNode);
      if (label) {
        const safe = esc(labelWithPrefix(whNode, label));
        mm.push(`${whNode}["${safe}"]:::WH`);
      }
    });
  });
  
  // Adicionar outros nós
  for (const [id, label] of nodeLabels.entries()) {
    if (!id.startsWith("WH_")) {
      const t = typeOfId(id);
      const safe = esc(labelWithPrefix(id, label || id));
      mm.push(`${id}["${safe}"]:::${t}`);
    }
  }
  
  for (const e of edgeSet) mm.push(e);
  
  const mermaid = mm.join("\n");
  
  // Insert logic (se necessário)
  let inserted = false, deleteCount = 0;
  // ... código de inserção se necessário ...
  
  return {
    mermaid,
    counts: {
      winning: whCount,
      backlogs: hbCount,
      validations: vrCount,
      learnings: lCount
    },
    debug,
    inserted,
    deleteCount
  };
}