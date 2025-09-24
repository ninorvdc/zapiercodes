export async function manageNotionPageSections({
    pageId,
    targetBlockName,        // ex.: "Validation Roadmap Visualization"
    body,                   // string Mermaid OU JSON {"mermaid":"flowchart TD\n..."} (pode vir com ```mermaid```)
    matchMode = "equals"    // "equals" | "startsWith" | "contains"
  }: {
    pageId: string;
    targetBlockName: string;
    body?: string;
    matchMode?: "equals" | "startsWith" | "contains";
  }): Promise<{
    replaced: boolean;
    deletedCount: number;
    appendedCount: number;
    anchored: boolean;
    anchorCreated: boolean;
    foundStart: boolean;   // compat
    foundEnd: boolean;     // compat
    parentId?: string | null;
    note?: string;
    debug?: string[];
  }> {
    const DEBUG: string[] = [];
  
    // ---------- inputs ----------
    const PAGE_ID = String(pageId || "").trim();
    const TITLE  = String(targetBlockName || "").trim();
    if (!PAGE_ID || !TITLE) throw new Error("pageId e targetBlockName são obrigatórios");
  
    // body pode ser string mermaid ou JSON { mermaid }
    const safeParse = <T=any>(s?: string): T | null => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const parsed = safeParse<Record<string, string>>(body) || {};
    // depois: não trime o conteúdo; use trim só para checar vazio
    let mermaidText = (parsed.mermaid ?? body ?? "").toString();
    if (!mermaidText.trim()) {
      return {
        replaced: false, deletedCount: 0, appendedCount: 0, anchored: false, anchorCreated: false,
        foundStart: false, foundEnd: false, parentId: null,
        note: "Body não contém Mermaid (vazio).",
        debug: DEBUG
      };
    }
    // tira cercas ```mermaid ... ```
    const fenceRe = /^```(?:mermaid)?\s*([\s\S]*?)\s*```$/i;
    const m = mermaidText.match(fenceRe);
    if (m) mermaidText = m[1];
  
    if (!mermaidText) {
      return {
        replaced: false, deletedCount: 0, appendedCount: 0, anchored: false, anchorCreated: false,
        foundStart: false, foundEnd: false, parentId: null,
        note: "Body não contém Mermaid (vazio).",
        debug: DEBUG
      };
    }
    if (!/^\s*(flowchart|graph)\b/i.test(mermaidText)) {
      DEBUG.push("Aviso: body não parece Mermaid (não começa com 'flowchart' ou 'graph'). Será inserido assim mesmo.");
    }
  
    // ---------- chunk seguro (≤2000) sempre terminando com \n exceto o último ----------
  function chunkMermaidSafe(s: string): string[] {
    // normaliza quebras
    s = s.replace(/\r\n/g, "\n");
  
    const MAX = 2000;     // hard limit Notion
    const TARGET = 1890;  // margem boa pra sobrar espaço pro \n
  
    const parts: string[] = [];
    let i = 0;
  
    while (i < s.length) {
      let end = Math.min(i + TARGET, s.length);
  
      if (end < s.length) {
        // tenta cortar exatamente após a última quebra antes do alvo
        const cut = s.lastIndexOf("\n", end);
        if (cut >= i + 10) end = cut + 1; // inclui o \n
      }
  
      parts.push(s.slice(i, end));
      i = end;
    }
  
    // Pós-passagem de segurança:
    //  - todo chunk (menos o último) termina com '\n'
    //  - todo chunk (menos o primeiro) começa com '\n'
    for (let k = 0; k < parts.length; k++) {
      if (k < parts.length - 1 && !parts[k].endsWith("\n")) parts[k] += "\n";
      if (k > 0 && !parts[k].startsWith("\n")) parts[k] = "\n" + parts[k];
  
      // nenhum pedaço pode ultrapassar 2000
      if (parts[k].length > MAX) {
        const segs = parts[k].match(new RegExp(`.{1,${MAX}}`, "gs")) || [parts[k]];
        parts.splice(k, 1, ...segs);
        // reposiciona para revalidar os novos
        k--;
      }
    }
  
    return parts;
  }
    const mermaidChunks = chunkMermaidSafe(mermaidText);
  
    // ---------- headers ----------
    const H = { "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
  
    // ---------- utils ----------
    const TEXTUAL_TYPES = new Set([
      "paragraph","heading_1","heading_2","heading_3",
      "callout","quote","to_do","toggle",
      "bulleted_list_item","numbered_list_item","code"
    ]);
    const HEADING_TYPES = new Set(["heading_1","heading_2","heading_3"]);
    const isHeading = (t?: string) => HEADING_TYPES.has(String(t));
  
    const norm = (s: string) => s.toLowerCase().trim();
    const matches = (text: string) => {
      const A = norm(text), B = norm(TITLE);
      if (matchMode === "equals") return A === B;
      if (matchMode === "startsWith") return A.startsWith(B);
      return A.includes(B);
    };
  
    const getBlockPlain = (blk: any): string => {
      const t = blk?.type;
      const node = t && blk?.[t];
      const rt = node && Array.isArray(node.rich_text) ? node.rich_text : [];
      return rt.map((x: any) => x?.plain_text ?? x?.text?.content ?? "").join("");
    };
  
    // HTTP robusto (sem reler body)
    async function http(url: string, init: RequestInit, label?: string) {
      const res = await fetchWithZapier(url, init);
      if (res.status >= 400) {
        let txt = "";
        try {
          const r2: any = (res as any).clone ? (res as any).clone() : res;
          txt = await r2.text();
        } catch {}
        DEBUG.push(`HTTP ${init.method||"GET"} ${label||url} -> ${res.status} ${res.statusText} | ${txt}`);
        if (!(res as any).clone) throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
      }
      await (res as any).throwErrorIfNotOk?.();
      return res;
    }
  
    async function listChildrenAll(parentId: string): Promise<any[]> {
      let results: any[] = [], cursor: string|undefined, more = true;
      while (more) {
        const url = `https://api.notion.com/v1/blocks/${encodeURIComponent(parentId)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await http(url, { method: "GET", headers: H }, `GET children ${parentId} (cursor=${cursor||"-"})`);
        const data = await res.json();
        results = results.concat(data?.results || []);
        more = !!data?.has_more; cursor = data?.next_cursor || undefined;
      }
      return results;
    }
  
    async function deleteBlock(id: string) {
      await http(`https://api.notion.com/v1/blocks/${encodeURIComponent(id)}`, { method: "DELETE", headers: H }, `DELETE block ${id}`);
    }
  
    // ---------- 1) garante página ativa ----------
    await http(`https://api.notion.com/v1/pages/${encodeURIComponent(PAGE_ID)}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ archived: false })
    }, `PATCH unarchive ${PAGE_ID}`);
  
    // ---------- 2) encontra/cria heading ----------
    type Anchor = { parentId: string; siblings: any[]; idx: number; id: string };
    async function findHeadingAnchor(rootId: string): Promise<Anchor | null> {
      const stack: Array<{ parentId: string; siblings: any[]; i: number }> = [];
      const rootSiblings = await listChildrenAll(rootId);
      stack.push({ parentId: rootId, siblings: rootSiblings, i: 0 });
  
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.i >= frame.siblings.length) { stack.pop(); continue; }
  
        const b = frame.siblings[frame.i++];
        if (isHeading(b?.type)) {
          const text = getBlockPlain(b);
          if (matches(text)) {
            return { parentId: frame.parentId, siblings: frame.siblings.slice(), idx: frame.i - 1, id: b.id };
          }
        }
        if (b?.has_children) {
          const kids = await listChildrenAll(b.id);
          stack.push({ parentId: b.id, siblings: kids, i: 0 });
        }
      }
      return null;
    }
  
    let anchor = await findHeadingAnchor(PAGE_ID);
    let anchorCreated = false;
  
    if (!anchor) {
      DEBUG.push(`Heading "${TITLE}" não encontrado; criando no final da página.`);
      const newHeading = [{
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: TITLE } }] }
      }];
      await http(`https://api.notion.com/v1/blocks/${encodeURIComponent(PAGE_ID)}/children`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ children: newHeading })
      }, "PATCH append heading");
  
      const rootSiblings = await listChildrenAll(PAGE_ID);
      for (let i = rootSiblings.length - 1; i >= 0; i--) {
        const b = rootSiblings[i];
        if (isHeading(b?.type) && matches(getBlockPlain(b))) {
          anchor = { parentId: PAGE_ID, siblings: rootSiblings, idx: i, id: b.id };
          break;
        }
      }
      anchorCreated = !!anchor;
    }
  
    if (!anchor) {
      return {
        replaced: false, deletedCount: 0, appendedCount: 0, anchored: false, anchorCreated: false,
        foundStart: false, foundEnd: false, parentId: null,
        note: `Não foi possível criar/achar o heading "${TITLE}".`,
        debug: DEBUG
      };
    }
  
    const { parentId, siblings, idx, id: anchorId } = anchor;
  
    // ---------- 3) apaga mermaids contíguos logo abaixo ----------
    let deletedCount = 0;
    let j = idx + 1;
    while (j < siblings.length) {
      const b = siblings[j];
      if (b?.type === "code" && String(b?.code?.language || "").toLowerCase() === "mermaid") {
        try { await deleteBlock(b.id); deletedCount++; } catch {}
        j++;
        continue;
      }
      break; // parou ao achar outro tipo
    }
  
    // ---------- 4) insere novo mermaid com chunks seguros ----------
    const chunks = chunkMermaidSafe(mermaidText);
    const richText = chunks.map(chunk => ({
      type: "text",
      text: { content: chunk }
    }));
  
    const newBlocks = [{
      object: "block",
      type: "code",
      code: { rich_text: richText, language: "mermaid" }
    }];
  
    await http(`https://api.notion.com/v1/blocks/${encodeURIComponent(parentId)}/children`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ children: newBlocks, after: anchorId })
    }, `PATCH insert mermaid after heading "${TITLE}"`);
  
    return {
      replaced: true,
      deletedCount,
      appendedCount: newBlocks.length,
      anchored: true,
      anchorCreated,
      foundStart: true,
      foundEnd: true,
      parentId,
      note: anchorCreated ? "Heading criado e mermaid inserido." : "Mermaid substituído após heading existente.",
      debug: DEBUG
    };
  }
  