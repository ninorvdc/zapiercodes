// Build JSON para Miro - VERSÃO COM AGRUPAMENTO POR HB COMPARTILHADOS
export async function buildWinningHypothesesMermaid({
  startWinningId, // Nome do database
  propertyNames = {
    wh_to_hb: "All Hypotheses Backlog",
    wh_to_bhq: "BHQ", // NEW: WH to BHQ property
    bhq_to_hb: "Hypotheses Backlog", // NEW: BHQ to HB property
    hb_to_vr: "Validation Roadmap",
    vr_to_l: "Learnings",
    l_to_hb: "New Hypotheses"
  },
  dbTitles = {
    wh: "Winning Hypotheses",
    bhq: "BHQ", // NEW: BHQ title
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
  graphData: string; // JSON string serializado
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  databaseId: string;
  databaseName: string;
  processedAt: string;
  winningCount: number;
  backlogsCount: number;
  validationsCount: number;
  learningsCount: number;
  debugLog: string; // Debug como string única
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

  function extractPageProperties(nodeType: string, page: any): Record<string, string> {
    const props: Record<string, string> = {};
    
    if (nodeType === "WH") {
      props.description = getTextProperty(page, "Description");
    } else if (nodeType === "BHQ") {
      // Extract BHQ specific properties
      props.description = getTextProperty(page, "Description");
      props.question = getTextProperty(page, "Question");
    } else if (nodeType === "HB") {
      props.description = getTextProperty(page, "Description");
    } else if (nodeType === "VR") {
      props.goal = getTextProperty(page, "Goal");
      props.summary = getTextProperty(page, "Summary");
    } else if (nodeType === "L") {
      props.positiveSummary = getTextProperty(page, "Positives Summary");
      props.negativeSummary = getTextProperty(page, "Negatives Summary");
    }
    
    // Remover propriedades vazias
    Object.keys(props).forEach(key => {
      if (!props[key]) delete props[key];
    });
    
    return props;
  }

  function getNodeStyle(nodeType: string) {
    const styles = {
      WH: {
        backgroundColor: "#8b5cf6",
        textColor: "#ffffff",
        borderColor: "#4c1d95",
        borderWidth: 1.5,
        shape: "rounded_rectangle"
      },
      BHQ: {
        backgroundColor: "#ec4899",
        textColor: "#ffffff",
        borderColor: "#9f1239",
        borderWidth: 1.5,
        shape: "rounded_rectangle"
      },
      HB: {
        backgroundColor: "#3b82f6",
        textColor: "#ffffff",
        borderColor: "#1e3a8a",
        borderWidth: 1.5,
        shape: "rounded_rectangle"
      },
      VR: {
        backgroundColor: "#f59e0b",
        textColor: "#111827",
        borderColor: "#9a3412",
        borderWidth: 1.5,
        shape: "rounded_rectangle"
      },
      L: {
        backgroundColor: "#10b981",
        textColor: "#ffffff",
        borderColor: "#064e3b",
        borderWidth: 1.5,
        shape: "rounded_rectangle"
      }
    };
    return styles[nodeType as keyof typeof styles] || styles.VR;
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

  const mid = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;

  // Estruturas principais
  const pageCache = new Map<string,any>();
  const nodes: any[] = [];
  const edges: any[] = [];
  const nodeMap = new Map<string, any>();
  const groups: any[] = [];
  
  // NOVO: Rastrear TODAS as conexões
  const allConnections = new Map<string, Set<string>>(); // sourceId -> Set<targetId>
  
  const processedBHQ = new Set<string>(); // NEW: Track processed BHQs
  const processedHB = new Set<string>();
  const processedVR = new Set<string>();
  const processedL = new Set<string>();
  
  let whCount = 0, bhqCount = 0, hbCount = 0, vrCount = 0, lCount = 0; // Added bhqCount
  let edgeIdCounter = 0;

  // Função para adicionar nó
  function addNode(nodeId: string, nodeType: string, page: any, groupId?: number) {
    if (nodeMap.has(nodeId)) return;
    
    const node = {
      id: nodeId,
      type: nodeType,
      title: getTitleFromPage(page),
      properties: extractPageProperties(nodeType, page),
      ...(groupId !== undefined && { groupId }),
      ...(emitStyles && { style: getNodeStyle(nodeType) })
    };
    
    nodes.push(node);
    nodeMap.set(nodeId, node);
    
    // Atualizar contadores
    if (nodeType === "WH") whCount++;
    else if (nodeType === "BHQ") bhqCount++;
    else if (nodeType === "HB") hbCount++;
    else if (nodeType === "VR") vrCount++;
    else if (nodeType === "L") lCount++;
  }

  // Função para registrar conexão (evita duplicatas)
  function registerConnection(sourceId: string, targetId: string, type: string) {
    const key = `${sourceId}->${targetId}`;
    if (!allConnections.has(key)) {
      allConnections.set(key, new Set());
      
      const edge = {
        id: `edge_${++edgeIdCounter}`,
        source: sourceId,
        target: targetId,
        type
      };
      edges.push(edge);
      debug.push(`Edge added: ${sourceId} -> ${targetId} (${type})`);
    }
  }

  // Agrupar WH por HB compartilhados
  function groupWHBySharedHB(
    whPages: string[], 
    whRelations: Map<string, string[]>
  ): string[][] {
    const whGroups: string[][] = [];
    const processed = new Set<string>();
    
    whPages.forEach(whId => {
      if (processed.has(whId)) return;
      
      const group = [whId];
      processed.add(whId);
      
      const whHBs = new Set(whRelations.get(`${whId}:${propertyNames.wh_to_hb}`) || []);
      
      whPages.forEach(otherId => {
        if (otherId === whId || processed.has(otherId)) return;
        
        const otherHBs = whRelations.get(`${otherId}:${propertyNames.wh_to_hb}`) || [];
        const hasSharedHB = otherHBs.some(hb => whHBs.has(hb));
        
        if (hasSharedHB) {
          group.push(otherId);
          processed.add(otherId);
          otherHBs.forEach(hb => whHBs.add(hb));
        }
      });
      
      whGroups.push(group);
    });
    
    whGroups.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a[0].localeCompare(b[0]);
    });
    
    return whGroups;
  }

  // Função recursiva para processar HB
  async function processHBRecursively(
    hbIds: string[],
    parentNodes: Map<string, string[]>, // Mudança: array de parents
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
      
      const hbNode = mid("HB", hbId);
      addNode(hbNode, "HB", hbPage);
      hbNodeMap.set(hbId, hbNode);
      
      // Adicionar TODAS as edges dos parents
      const parents = parentNodes.get(hbId) || [];
      parents.forEach(parentNode => {
        // Determine edge type based on parent node type
        let edgeType = "wh_to_hb";
        if (parentNode.startsWith("BHQ_")) {
          edgeType = "bhq_to_hb";
        } else if (parentNode.startsWith("L_")) {
          edgeType = "l_to_hb";
        }
        registerConnection(parentNode, hbNode, edgeType);
      });
      
      hbRelSpecs.push({ pageId: hbId, propName: propertyNames.hb_to_vr, page: hbPage });
    });
    
    // Para HBs já processados, adicionar edges
    hbIds.filter(id => processedHB.has(id) && !newHbIds.includes(id)).forEach(hbId => {
      const hbNode = mid("HB", hbId);
      const parents = parentNodes.get(hbId) || [];
      parents.forEach(parentNode => {
        // Determine edge type based on parent node type
        let edgeType = "wh_to_hb";
        if (parentNode.startsWith("BHQ_")) {
          edgeType = "bhq_to_hb";
        } else if (parentNode.startsWith("L_")) {
          edgeType = "l_to_hb";
        }
        registerConnection(parentNode, hbNode, edgeType);
      });
    });
    
    const hbRelations = await getRelationsBatch(hbRelSpecs);
    
    const vrIds: string[] = [];
    const vrParentMap = new Map<string, string[]>();
    
    newHbIds.forEach(hbId => {
      const vrs = hbRelations.get(`${hbId}:${propertyNames.hb_to_vr}`) || [];
      const hbNode = hbNodeMap.get(hbId);
      if (hbNode) {
        vrs.forEach(vrId => {
          if (!vrParentMap.has(vrId)) {
            vrParentMap.set(vrId, []);
          }
          vrParentMap.get(vrId)!.push(hbNode);
          if (!processedVR.has(vrId)) {
            vrIds.push(vrId);
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
      
      const vrNode = mid("VR", vrId);
      addNode(vrNode, "VR", vrPage);
      vrNodeMap.set(vrId, vrNode);
      
      const hbNodes = vrParentMap.get(vrId) || [];
      hbNodes.forEach(hbNode => {
        registerConnection(hbNode, vrNode, "hb_to_vr");
      });
      
      if (propertyNames.vr_to_l) {
        vrRelSpecs.push({ pageId: vrId, propName: propertyNames.vr_to_l, page: vrPage });
      }
    });
    
    if (!propertyNames.vr_to_l || !vrRelSpecs.length) return;
    
    const vrRelations = await getRelationsBatch(vrRelSpecs);
    
    const lIds: string[] = [];
    const lParentMap = new Map<string, string[]>();
    
    vrIds.forEach(vrId => {
      const ls = vrRelations.get(`${vrId}:${propertyNames.vr_to_l}`) || [];
      const vrNode = vrNodeMap.get(vrId);
      if (vrNode) {
        ls.forEach(lId => {
          if (!lParentMap.has(lId)) {
            lParentMap.set(lId, []);
          }
          lParentMap.get(lId)!.push(vrNode);
          if (!processedL.has(lId)) {
            lIds.push(lId);
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
      
      const lNode = mid("L", lId);
      addNode(lNode, "L", lPage);
      lNodeMap.set(lId, lNode);
      
      const vrNodes = lParentMap.get(lId) || [];
      vrNodes.forEach(vrNode => {
        registerConnection(vrNode, lNode, "vr_to_l");
      });
      
      if (propertyNames.l_to_hb) {
        lRelSpecs.push({ pageId: lId, propName: propertyNames.l_to_hb, page: lPage });
      }
    });
    
    if (!propertyNames.l_to_hb || !lRelSpecs.length) return;
    
    const lRelations = await getRelationsBatch(lRelSpecs);
    
    const newHBIds: string[] = [];
    const newHBParentMap = new Map<string, string[]>();
    
    lIds.forEach(lId => {
      const hbs = lRelations.get(`${lId}:${propertyNames.l_to_hb}`) || [];
      const lNode = lNodeMap.get(lId);
      if (lNode) {
        hbs.forEach(hbId => {
          if (!newHBParentMap.has(hbId)) {
            newHBParentMap.set(hbId, []);
          }
          newHBParentMap.get(hbId)!.push(lNode);
          
          if (!processedHB.has(hbId)) {
            if (!newHBIds.includes(hbId)) {
              newHBIds.push(hbId);
            }
          } else {
            // HB já existe, adicionar edge
            const hbNode = mid("HB", hbId);
            registerConnection(lNode, hbNode, "l_to_hb");
          }
        });
      }
    });
    
    if (newHBIds.length) {
      await processHBRecursively(newHBIds, newHBParentMap, depth + 1);
    }
  }

  // PROCESSAMENTO PRINCIPAL
  const databaseName = sanitizeId(startWinningId);
  debug.push(`Starting process for database: "${databaseName}"`);
  
  const dbId = await getDatabaseIdByName(databaseName);
  
  if (!dbId) {
    throw new Error(`Database "${databaseName}" not found. Please check the database name and ensure you have access to it.`);
  }
  
  const allWHPages = await getAllPagesFromDatabase(dbId);
  
  if (!allWHPages.length) {
    throw new Error(`Database "${databaseName}" is empty or you don't have access to its pages.`);
  }
  
  debug.push(`Processing ${allWHPages.length} Winning Hypotheses from database`);
  
  await getPagesInBatch(allWHPages);
  
  const whRelSpecs: any[] = [];
  const whBHQRelSpecs: any[] = [];
  
  allWHPages.forEach(whId => {
    const whPage = pageCache.get(whId);
    if (!whPage) return;
    // Check for both BHQ and HB relationships
    whRelSpecs.push({ pageId: whId, propName: propertyNames.wh_to_hb, page: whPage });
    whBHQRelSpecs.push({ pageId: whId, propName: propertyNames.wh_to_bhq, page: whPage });
  });
  
  const whRelations = await getRelationsBatch(whRelSpecs);
  const whBHQRelations = await getRelationsBatch(whBHQRelSpecs);
  
  // Agrupar WH por HB compartilhados
  const whGroups = groupWHBySharedHB(allWHPages, whRelations);
  debug.push(`Organized ${allWHPages.length} WH into ${whGroups.length} groups`);
  
  // Criar grupos no JSON
  whGroups.forEach((group, groupIndex) => {
    const groupObj = {
      id: groupIndex,
      name: `Related WH Group ${groupIndex + 1}`,
      nodeIds: group.map(id => mid("WH", id)),
      size: group.length
    };
    groups.push(groupObj);
    
    // Adicionar nós WH com groupId
    group.forEach(whId => {
      const whPage = pageCache.get(whId);
      if (!whPage) return;
      
      const whNode = mid("WH", whId);
      addNode(whNode, "WH", whPage, groupIndex);
    });
  });
  
  // Check if we have BHQ relationships
  const hasBHQRelations = Array.from(whBHQRelations.values()).some(bhqs => bhqs && bhqs.length > 0);
  debug.push(`BHQ relationships found: ${hasBHQRelations}`);
  
  // Process BHQ layer if present
  if (hasBHQRelations) {
    // First, process BHQ nodes
    const bhqParentMap = new Map<string, string[]>();
    const allBHQIds = new Set<string>();
    
    whGroups.forEach(group => {
      group.forEach(whId => {
        const whNode = mid("WH", whId);
        const bhqs = whBHQRelations.get(`${whId}:${propertyNames.wh_to_bhq}`) || [];
        
        bhqs.forEach(bhqId => {
          allBHQIds.add(bhqId);
          if (!bhqParentMap.has(bhqId)) {
            bhqParentMap.set(bhqId, []);
          }
          bhqParentMap.get(bhqId)!.push(whNode);
        });
      });
    });
    
    // Fetch BHQ pages
    if (allBHQIds.size > 0) {
      debug.push(`Found ${allBHQIds.size} unique BHQ nodes`);
      await getPagesInBatch(Array.from(allBHQIds));
      
      // Create BHQ nodes and edges from WH to BHQ
      const bhqRelSpecs: any[] = [];
      
      allBHQIds.forEach(bhqId => {
        const bhqPage = pageCache.get(bhqId);
        if (!bhqPage) return;
        
        const bhqNode = mid("BHQ", bhqId);
        addNode(bhqNode, "BHQ", bhqPage);
        
        // Add edges from WH to BHQ
        const parents = bhqParentMap.get(bhqId) || [];
        parents.forEach(parentNode => {
          registerConnection(parentNode, bhqNode, "wh_to_bhq");
        });
        
        // Prepare to fetch BHQ to HB relationships
        bhqRelSpecs.push({ pageId: bhqId, propName: propertyNames.bhq_to_hb, page: bhqPage });
      });
      
      // Get BHQ to HB relationships
      const bhqRelations = await getRelationsBatch(bhqRelSpecs);
      
      // Collect HBs from BHQs
      const hbParentMap = new Map<string, string[]>();
      
      allBHQIds.forEach(bhqId => {
        const bhqNode = mid("BHQ", bhqId);
        const hbs = bhqRelations.get(`${bhqId}:${propertyNames.bhq_to_hb}`) || [];
        
        hbs.forEach(hbId => {
          if (!hbParentMap.has(hbId)) {
            hbParentMap.set(hbId, []);
          }
          hbParentMap.get(hbId)!.push(bhqNode);
        });
      });
      
      // Process HBs and their chains
      const uniqueHBIds = Array.from(hbParentMap.keys());
      if (uniqueHBIds.length) {
        debug.push(`Found ${uniqueHBIds.length} unique Hypothesis Backlogs to process from BHQs`);
        await processHBRecursively(uniqueHBIds, hbParentMap, 0);
      }
    }
  } else {
    // Original flow: WH directly to HB
    const hbParentMap = new Map<string, string[]>();
    
    whGroups.forEach(group => {
      group.forEach(whId => {
        const whNode = mid("WH", whId);
        const hbs = whRelations.get(`${whId}:${propertyNames.wh_to_hb}`) || [];
        
        hbs.forEach(hbId => {
          if (!hbParentMap.has(hbId)) {
            hbParentMap.set(hbId, []);
          }
          hbParentMap.get(hbId)!.push(whNode);
        });
      });
    });
    
    // Process HBs and their chains
    const uniqueHBIds = Array.from(hbParentMap.keys());
    if (uniqueHBIds.length) {
      debug.push(`Found ${uniqueHBIds.length} unique Hypothesis Backlogs to process`);
      await processHBRecursively(uniqueHBIds, hbParentMap, 0);
    }
  }

  // Criar objeto de dados do grafo
  const graphDataObj = {
    nodes: nodes,
    edges: edges,
    groups: groups,
    metadata: {
      databaseId: dbId,
      databaseName: databaseName,
      processedAt: new Date().toISOString(),
      counts: {
        winning: whCount,
        bhq: bhqCount,
        backlogs: hbCount,
        validations: vrCount,
        learnings: lCount,
        totalNodes: nodes.length,
        totalEdges: edges.length
      }
    }
  };

  debug.push(`Final counts: ${nodes.length} nodes, ${edges.length} edges`);

  // Retornar como campos flat para evitar quebra no Zapier
  return {
    graphData: JSON.stringify(graphDataObj), // Serializado como string
    nodeCount: nodes.length,
    edgeCount: edges.length,
    groupCount: groups.length,
    databaseId: dbId,
    databaseName: databaseName,
    processedAt: new Date().toISOString(),
    winningCount: whCount,
    bhqCount: bhqCount,
    backlogsCount: hbCount,
    validationsCount: vrCount,
    learningsCount: lCount,
    debugLog: debug.join("\n") // Debug como string única
  };
}