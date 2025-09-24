export async function createCardsOnMiroBoard({
  miroBoardId,
  miroAccessToken, // MANTIDO mas não usado - Zapier gerencia a autenticação
  DataJson,
  clearBoard
}: {
  miroBoardId: string;
  miroAccessToken: string;
  DataJson: string;
  clearBoard: boolean;
}): Promise<{ 
  result: string;
  debugInfo?: string;
}> {
  
  const debug = [];
  
  // Miro API configuration
  const MIRO_API_BASE = `https://api.miro.com/v2/boards/${miroBoardId}`;
  
  // Headers básicos - SEM Authorization (Zapier adiciona automaticamente)
  const miroHeaders = { 
    'Content-Type': 'application/json' 
  };

  // IMPORTANTE: Marcador para identificar elementos do sistema
  // Usamos um ID discreto e compacto no final do conteúdo
  // Exemplo: "[id:f9f3967]" no final do texto do card
  const SYSTEM_MARKER = '\n[id:';
  const MARKER_END = ']';
  
  // Alternativas se quiser tornar ainda mais discreto:
  // 1. Usar fonte menor: '<span style="font-size:8px;color:#e0e0e0">[id:xxx]</span>'
  // 2. Usar comentário HTML: '<!-- sys:xxx -->' (se Miro suportar)
  // 3. Usar Unicode invisível: '\u200B\u200Cid:xxx\u200B' (pode causar problemas)
  
  // Função para criar ID compacto (últimos 8 caracteres do UUID)
  function getCompactId(fullId) {
    // Pegar apenas os últimos 8 caracteres para ser mais discreto
    return fullId.replace(/_/g, '').slice(-8);
  }
  
  // Mapa para rastrear IDs completos <-> compactos
  const compactToFullId = new Map();
  const fullToCompactId = new Map();

  // Layout configuration - MANTIDO COMO ESTÁ
  const LAYOUT = {
    nodeWidth: 350,
    nodeHeight: 250,
    horizontalSpacing: 400,
    verticalSpacing: 350,
    startX: 0,
    startY: -1000
  };

  // Parse the DataJson - MANTIDO COMO ESTÁ
  let parsedData;
  try {
    if (typeof DataJson === 'string') {
      const tempParse = JSON.parse(DataJson);
      
      if (tempParse.graphData && typeof tempParse.graphData === 'string') {
        parsedData = JSON.parse(tempParse.graphData);
        debug.push(`Parsed nested graphData successfully`);
      } else if (tempParse.nodes && tempParse.edges) {
        parsedData = tempParse;
        debug.push(`Using direct nodes/edges structure`);
      } else {
        parsedData = tempParse;
        debug.push(`Using parsed data as-is`);
      }
    } else {
      parsedData = DataJson;
      debug.push(`DataJson was already an object`);
    }
  } catch (err) {
    return { 
      result: `Error parsing JSON: ${err.message}`,
      debugInfo: `Failed at JSON parsing stage: ${err.message}`
    };
  }

  // Validate structure - MANTIDO COMO ESTÁ
  if (!parsedData.nodes || !Array.isArray(parsedData.nodes)) {
    return { 
      result: 'Error: JSON does not contain nodes array',
      debugInfo: `Structure found: ${JSON.stringify(Object.keys(parsedData || {}))}`
    };
  }

  if (!parsedData.edges || !Array.isArray(parsedData.edges)) {
    return { 
      result: 'Error: JSON does not contain edges array',
      debugInfo: `Structure found: ${JSON.stringify(Object.keys(parsedData || {}))}`
    };
  }

  debug.push(`Found ${parsedData.nodes.length} nodes and ${parsedData.edges.length} edges`);

  // ==============================================================
  // NOVA SEÇÃO: BUSCAR E MAPEAR ELEMENTOS EXISTENTES
  // ==============================================================
  
  const existingElements = {
    shapes: new Map(),     // nodeId -> miroShape
    connectors: [],        // array de conectores (vamos mapear depois)
    others: []            // elementos sem marcador (manuais)
  };
  
  // Mapas auxiliares para rastrear IDs do Miro
  const miroIdToNodeId = new Map(); // miroId -> nodeId

  // Função auxiliar para extrair ID do sistema do conteúdo
  function extractSystemId(item) {
    if (!item.data?.content) return null;
    
    // Procurar pelo marcador no conteúdo
    const content = item.data.content;
    const markerStart = content.indexOf(SYSTEM_MARKER);
    
    if (markerStart === -1) return null;
    
    const idStart = markerStart + SYSTEM_MARKER.length;
    const idEnd = content.indexOf(MARKER_END, idStart);
    
    if (idEnd === -1) return null;
    
    const compactId = content.substring(idStart, idEnd);
    
    // Converter ID compacto para ID completo
    return compactToFullId.get(compactId) || null;
  }

  // Se NÃO for clearBoard, buscar elementos existentes
  if (!clearBoard) {
    try {
      debug.push('Fetching existing board elements...');
      
      // Buscar todos os items do board
      let allItems = [];
      let cursor = null;
      
      do {
        const url = cursor 
          ? `${MIRO_API_BASE}/items?limit=50&cursor=${cursor}`
          : `${MIRO_API_BASE}/items?limit=50`;
          
        const response = await fetchWithZapier(url, {
          method: 'GET',
          headers: miroHeaders
        });
        
        if (!response.ok) {
          debug.push(`Warning: Could not fetch existing items`);
          break;
        }
        
        const data = await response.json();
        allItems = allItems.concat(data.data || []);
        cursor = data.cursor;
        
      } while (cursor);
      
      debug.push(`Found ${allItems.length} existing items on board`);
      
      // Classificar items existentes
      for (const item of allItems) {
        if (item.type === 'shape') {
          const systemId = extractSystemId(item);
          
          if (systemId) {
            // É um nó do sistema
            existingElements.shapes.set(systemId, item);
            miroIdToNodeId.set(item.id, systemId);
            debug.push(`Found existing system node: ${systemId}`);
          } else {
            // Elemento manual (preservar)
            existingElements.others.push(item);
          }
        } else if (item.type === 'connector') {
          // Guardar todos os conectores para processar depois
          existingElements.connectors.push(item);
        } else {
          // Outros elementos manuais
          existingElements.others.push(item);
        }
      }
      
      debug.push(`Classified: ${existingElements.shapes.size} system nodes, ${existingElements.connectors.length} connectors, ${existingElements.others.length} manual elements`);
      
    } catch (err) {
      debug.push(`Error fetching existing elements: ${err.message}`);
      // Continuar mesmo com erro - criar tudo do zero
    }
  }

  // ==============================================================
  // PROCESSAR NODES E EDGES - MANTIDO COMO ESTÁ
  // ==============================================================
  
  const nodes = new Map();
  const nodesByType = {
    WH: [],
    HB: [],
    VR: [],
    L: []
  };
  
  const childToParents = new Map();
  const parentToChildren = new Map();
  
  parsedData.edges.forEach(edge => {
    if (!parentToChildren.has(edge.source)) {
      parentToChildren.set(edge.source, []);
    }
    parentToChildren.get(edge.source).push(edge.target);
    
    if (!childToParents.has(edge.target)) {
      childToParents.set(edge.target, []);
    }
    childToParents.get(edge.target).push(edge.source);
  });

  // Process all nodes - MANTIDO COMO ESTÁ
  parsedData.nodes.forEach(node => {
    // Criar mapeamento de IDs
    const compactId = getCompactId(node.id);
    compactToFullId.set(compactId, node.id);
    fullToCompactId.set(node.id, compactId);
    
    let nodeText = '';
    
    switch(node.type) {
      case 'WH':
        nodeText = `<b>WH: ${node.title || 'Untitled'}</b>`;
        if (node.properties?.description) {
          nodeText += `<br/><br/>${node.properties.description}`;
        }
        break;
      
      case 'HB':
        nodeText = `<b>HB: ${node.title || 'Untitled'}</b>`;
        if (node.properties?.description) {
          nodeText += `<br/><br/><b>Description:</b><br/>${node.properties.description}`;
        }
        break;
      
      case 'VR':
        nodeText = `<b>VR: ${node.title || 'Untitled'}</b>`;
        if (node.properties?.goal) {
          nodeText += `<br/><br/><b>Goal:</b><br/>${node.properties.goal}`;
        }
        if (node.properties?.summary) {
          nodeText += `<br/><br/><b>Summary:</b><br/>${node.properties.summary}`;
        }
        break;
      
      case 'L':
        nodeText = `<b>BML: ${node.title || 'Untitled'}</b>`;
        if (node.properties?.positiveSummary) {
          nodeText += `<br/><br/><b>Positives:</b><br/>✓ ${node.properties.positiveSummary}`;
        }
        if (node.properties?.negativeSummary) {
          nodeText += `<br/><br/><b>Negatives:</b><br/>✗ ${node.properties.negativeSummary}`;
        }
        break;
      
      default:
        nodeText = node.title || 'Untitled';
    }
    
    nodes.set(node.id, {
      label: nodeText,
      type: node.type,
      style: node.style || {},
      originalNode: node,
      level: -1
    });
    
    if (nodesByType[node.type]) {
      nodesByType[node.type].push(node.id);
    }
  });

  // TODO O CÓDIGO DE CÁLCULO DE LAYOUT - MANTIDO EXATAMENTE COMO ESTÁ
  // [Código de calculateLevels, buildGraphWithLevels, calculateDynamicLevels, etc.]
  // [Mantendo exatamente como no código original para não quebrar]
  
  // Calculate levels based on hierarchy
  const calculateLevels = () => {
    nodesByType.WH.forEach(nodeId => {
      const node = nodes.get(nodeId);
      if (node) node.level = 0;
    });
    
    nodesByType.HB.forEach(nodeId => {
      const node = nodes.get(nodeId);
      if (node) node.level = 1;
    });
    
    nodesByType.VR.forEach(nodeId => {
      const node = nodes.get(nodeId);
      if (node) node.level = 2;
    });
    
    nodesByType.L.forEach(nodeId => {
      const node = nodes.get(nodeId);
      if (node) node.level = 3;
    });
  };
  
  calculateLevels();

  // Calculate positions - TODO O CÓDIGO DE LAYOUT MANTIDO
  const positions = new Map();

  const DYNAMIC_LAYOUT = {
    nodeWidth: 350,
    nodeHeight: 250,
    baseHorizontalSpacing: 400,
    verticalSpacing: 350,
    startX: 0,
    startY: -1000
  };

  function buildGraphWithLevels() {
    const graph = {
      nodes: new Map(),
      edges: parsedData.edges,
      maxLevel: 0
    };
    
    nodes.forEach((nodeData, nodeId) => {
      graph.nodes.set(nodeId, {
        id: nodeId,
        type: nodeData.type,
        label: nodeData.label,
        children: [],
        parents: [],
        level: -1,
        visited: false,
        x: 0,
        y: 0
      });
    });
    
    parsedData.edges.forEach(edge => {
      const parent = graph.nodes.get(edge.source);
      const child = graph.nodes.get(edge.target);
      
      if (parent && child) {
        parent.children.push(edge.target);
        child.parents.push(edge.source);
      }
    });
    
    return graph;
  }

  function calculateDynamicLevels(graph) {
    const visited = new Set();
    const levels = new Map();
    
    function setLevel(nodeId, suggestedLevel, path = new Set()) {
      if (path.has(nodeId)) return;
      path.add(nodeId);
      
      const node = graph.nodes.get(nodeId);
      if (!node) return;
      
      const currentLevel = levels.get(nodeId) || -1;
      if (suggestedLevel > currentLevel) {
        levels.set(nodeId, suggestedLevel);
        node.level = suggestedLevel;
        graph.maxLevel = Math.max(graph.maxLevel, suggestedLevel);
      } else if (currentLevel >= 0) {
        return;
      }
      
      node.children.forEach(childId => {
        const child = graph.nodes.get(childId);
        if (child) {
          let nextLevel = suggestedLevel + 1;
          
          if (node.type === 'L' && child.type === 'HB') {
            nextLevel = suggestedLevel + 2;
          }
          
          setLevel(childId, nextLevel, new Set(path));
        }
      });
      
      path.delete(nodeId);
    }
    
    nodesByType.WH.forEach(whId => {
      setLevel(whId, 0);
    });
    
    levels.forEach((level, nodeId) => {
      const node = graph.nodes.get(nodeId);
      if (node) node.level = level;
    });
    
    return graph;
  }

  function calculateSubtreeWidth(nodeId, graph, visited = new Set()) {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);
    
    const node = graph.nodes.get(nodeId);
    if (!node) return 0;
    
    if (node.children.length === 0) {
      return 1;
    }
    
    let totalWidth = 0;
    node.children.forEach(childId => {
      totalWidth += calculateSubtreeWidth(childId, graph, new Set(visited));
    });
    
    return Math.max(1, totalWidth);
  }

  function positionByLevels(graph) {
    const positioned = new Set();
    const subtreeWidths = new Map();
    
    graph.nodes.forEach((node, nodeId) => {
      const width = calculateSubtreeWidth(nodeId, graph);
      subtreeWidths.set(nodeId, width);
    });
    
    function positionNode(nodeId, centerX, level) {
      if (positioned.has(nodeId)) return;
      positioned.add(nodeId);
      
      const node = graph.nodes.get(nodeId);
      if (!node) return;
      
      // IMPORTANTE: Se já existe no board, preservar posição!
      const existingShape = existingElements.shapes.get(nodeId);
      if (existingShape && existingShape.position) {
        // Preservar posição existente
        positions.set(nodeId, { 
          x: existingShape.position.x, 
          y: existingShape.position.y 
        });
        
        // Ainda processar filhos, mas com base na posição preservada
        if (node.children.length > 0) {
          const directChildren = node.children.filter(childId => {
            const child = graph.nodes.get(childId);
            return child && !positioned.has(childId);
          });
          
          if (directChildren.length > 0) {
            const childrenWidths = directChildren.map(childId => subtreeWidths.get(childId) || 1);
            const totalChildrenWidth = childrenWidths.reduce((sum, w) => sum + w, 0);
            
            let spacing = DYNAMIC_LAYOUT.baseHorizontalSpacing;
            if (totalChildrenWidth > 5) spacing *= 1.2;
            if (totalChildrenWidth > 10) spacing *= 1.5;
            
            const totalSpan = totalChildrenWidth * spacing;
            let currentX = existingShape.position.x - (totalSpan / 2) + (spacing / 2);
            
            directChildren.forEach((childId, index) => {
              const childWidth = childrenWidths[index];
              const childCenterX = currentX + ((childWidth - 1) * spacing / 2);
              
              const child = graph.nodes.get(childId);
              let childLevel = level + 1;
              
              if (node.type === 'L' && child.type === 'HB') {
                childLevel = level + 2;
              }
              
              positionNode(childId, childCenterX, childLevel);
              
              currentX += childWidth * spacing;
            });
          }
        }
        
        return; // Posição preservada, sair
      }
      
      // Se não existe, calcular nova posição normalmente
      const y = DYNAMIC_LAYOUT.startY + (level * DYNAMIC_LAYOUT.verticalSpacing);
      positions.set(nodeId, { x: centerX, y: y });
      
      if (node.children.length === 0) return;
      
      const directChildren = node.children.filter(childId => {
        const child = graph.nodes.get(childId);
        return child && !positioned.has(childId);
      });
      
      if (directChildren.length === 0) return;
      
      const childrenWidths = directChildren.map(childId => subtreeWidths.get(childId) || 1);
      const totalChildrenWidth = childrenWidths.reduce((sum, w) => sum + w, 0);
      
      let spacing = DYNAMIC_LAYOUT.baseHorizontalSpacing;
      if (totalChildrenWidth > 5) spacing *= 1.2;
      if (totalChildrenWidth > 10) spacing *= 1.5;
      
      const totalSpan = totalChildrenWidth * spacing;
      let currentX = centerX - (totalSpan / 2) + (spacing / 2);
      
      directChildren.forEach((childId, index) => {
        const childWidth = childrenWidths[index];
        const childCenterX = currentX + ((childWidth - 1) * spacing / 2);
        
        const child = graph.nodes.get(childId);
        let childLevel = level + 1;
        
        if (node.type === 'L' && child.type === 'HB') {
          childLevel = level + 2;
        }
        
        positionNode(childId, childCenterX, childLevel);
        
        currentX += childWidth * spacing;
      });
    }
    
    const roots = [];
    graph.nodes.forEach((node, nodeId) => {
      if (node.type === 'WH' || node.parents.length === 0) {
        roots.push(nodeId);
      }
    });
    
    const whInfo = new Map();
    
    roots.forEach(whId => {
      const node = graph.nodes.get(whId);
      const children = node.children || [];
      let sharedCount = 0;
      
      children.forEach(childId => {
        const child = graph.nodes.get(childId);
        if (child && child.parents.length > 1) {
          sharedCount++;
        }
      });
      
      const subtreeWidth = subtreeWidths.get(whId) || 1;
      whInfo.set(whId, { id: whId, sharedCount, children, subtreeWidth });
    });
    
    const sortedRoots = Array.from(whInfo.values()).sort((a, b) => b.sharedCount - a.sharedCount);
    
    const optimizedOrder = [];
    if (sortedRoots.length === 3) {
      const maxShared = sortedRoots[0];
      const others = sortedRoots.filter(item => item.id !== maxShared.id);
      
      if (others.length >= 1) optimizedOrder.push(others[0]);
      optimizedOrder.push(maxShared);
      if (others.length >= 2) optimizedOrder.push(others[1]);
    } else {
      const left = [];
      const right = [];
      sortedRoots.forEach((item, index) => {
        if (index === 0) {
          left.push(item);
        } else if (index % 2 === 1) {
          right.push(item);
        } else {
          left.unshift(item);
        }
      });
      optimizedOrder.push(...left, ...right);
    }
    
    let currentX = 0;
    const whPositions = new Map();
    
    optimizedOrder.forEach((whData, index) => {
      const whWidth = whData.subtreeWidth;
      const spacing = DYNAMIC_LAYOUT.baseHorizontalSpacing;
      
      const requiredSpace = whWidth * spacing;
      
      if (index > 0) {
        const prevWhData = optimizedOrder[index - 1];
        const prevWidth = prevWhData.subtreeWidth;
        const prevSpace = prevWidth * spacing;
        
        currentX += (prevSpace / 2) + (requiredSpace / 2);
      }
      
      whPositions.set(whData.id, currentX);
    });
    
    if (whPositions.size > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      
      whPositions.forEach(x => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      });
      
      const centerOffset = -(minX + maxX) / 2;
      
      optimizedOrder.forEach(whData => {
        const x = whPositions.get(whData.id) + centerOffset;
        positionNode(whData.id, x, 0);
      });
    }
    
    graph.nodes.forEach((node, nodeId) => {
      if (!positions.has(nodeId)) {
        const y = DYNAMIC_LAYOUT.startY + (node.level * DYNAMIC_LAYOUT.verticalSpacing);
        const x = currentX + 500;
        positions.set(nodeId, { x, y });
        currentX += DYNAMIC_LAYOUT.baseHorizontalSpacing;
      }
    });
  }

  const graph = buildGraphWithLevels();
  calculateDynamicLevels(graph);
  positionByLevels(graph);

  debug.push(`Positioned ${positions.size} nodes with dynamic levels`);

  // ==============================================================
  // LÓGICA DE SINCRONIZAÇÃO (NOVO)
  // ==============================================================
  
  // Se clearBoard, limpar APENAS elementos do sistema
  if (clearBoard) {
    debug.push('Clear board requested - removing all system elements');
    
    // Remover shapes do sistema
    for (const [nodeId, shape] of existingElements.shapes) {
      try {
        await fetchWithZapier(`${MIRO_API_BASE}/items/${shape.id}`, {
          method: 'DELETE',
          headers: miroHeaders
        });
        debug.push(`Deleted system shape: ${nodeId}`);
      } catch (err) {
        debug.push(`Error deleting shape ${nodeId}: ${err}`);
      }
    }
    
    // Remover connectors do sistema
    for (const [connId, connector] of existingElements.connectors) {
      try {
        await fetchWithZapier(`${MIRO_API_BASE}/items/${connector.id}`, {
          method: 'DELETE',
          headers: miroHeaders
        });
        debug.push(`Deleted system connector: ${connId}`);
      } catch (err) {
        debug.push(`Error deleting connector ${connId}: ${err}`);
      }
    }
    
    // Limpar mapas/arrays após deletar
    existingElements.shapes.clear();
    existingElements.connectors = [];
  }

  // Identificar operações necessárias
  const toCreate = new Set();
  const toUpdate = new Set();
  const toDelete = new Set();

  // Nodes: identificar o que criar/atualizar
  for (const [nodeId, nodeData] of nodes) {
    if (existingElements.shapes.has(nodeId)) {
      toUpdate.add(nodeId);
    } else {
      toCreate.add(nodeId);
    }
  }

  // Nodes: identificar o que deletar
  for (const [nodeId] of existingElements.shapes) {
    if (!nodes.has(nodeId)) {
      toDelete.add(nodeId);
    }
  }

  debug.push(`Node operations: Create ${toCreate.size}, Update ${toUpdate.size}, Delete ${toDelete.size}`);

  // ==============================================================
  // EXECUTAR OPERAÇÕES DE SINCRONIZAÇÃO
  // ==============================================================
  
  const miroNodeIds = new Map();
  let nodesCreated = 0;
  let nodesUpdated = 0;
  let nodesDeleted = 0;
  let errors = 0;

  // 1. DELETAR nós obsoletos
  for (const nodeId of toDelete) {
    const shape = existingElements.shapes.get(nodeId);
    if (shape) {
      try {
        await fetchWithZapier(`${MIRO_API_BASE}/items/${shape.id}`, {
          method: 'DELETE',
          headers: miroHeaders
        });
        nodesDeleted++;
        debug.push(`Deleted obsolete node: ${nodeId}`);
      } catch (err) {
        debug.push(`Error deleting node ${nodeId}: ${err.message}`);
        errors++;
      }
    }
  }

  // 2. ATUALIZAR nós existentes (apenas conteúdo e estilo)
  for (const nodeId of toUpdate) {
    const nodeData = nodes.get(nodeId);
    const existingShape = existingElements.shapes.get(nodeId);
    
    if (!nodeData || !existingShape) continue;
    
    // IMPORTANTE: Adicionar ao mapa de IDs antes de atualizar
    miroNodeIds.set(nodeId, existingShape.id);
    miroIdToNodeId.set(existingShape.id, nodeId);
    
    const style = nodeData.style;
    const fillColor = style?.backgroundColor || style?.fillColor || "#6b7280";
    const textColor = style?.textColor || "#ffffff";
    const borderColor = style?.borderColor || "#374151";
    
    const updateBody = {
      data: {
        // Manter marcador ao atualizar (usar ID compacto)
        content: nodeData.label.substring(0, 4096) + `${SYSTEM_MARKER}${fullToCompactId.get(nodeId)}${MARKER_END}`
        // Manter shape existente para não perder formato manual
      },
      style: {
        fillColor: fillColor,
        textAlign: "left",
        textAlignVertical: "top",
        fontSize: "14",
        fontFamily: "arial",
        color: textColor,
        borderColor: borderColor,
        borderWidth: "2",
        borderStyle: "normal"
      }
      // NÃO atualizar position nem geometry - preservar layout manual
    };

    try {
      const response = await fetchWithZapier(`${MIRO_API_BASE}/shapes/${existingShape.id}`, {
        method: 'PATCH',
        headers: miroHeaders,
        body: JSON.stringify(updateBody)
      });
      
      if (response.ok) {
        nodesUpdated++;
        debug.push(`Updated node: ${nodeId}`);
      } else {
        const errorText = await response.text();
        debug.push(`Error updating node ${nodeId}: ${errorText.substring(0, 200)}`);
        errors++;
      }
    } catch (err) {
      debug.push(`Error updating node ${nodeId}: ${err.message}`);
      errors++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // 3. CRIAR novos nós
  for (const nodeId of toCreate) {
    const nodeData = nodes.get(nodeId);
    if (!nodeData) continue;
    
    const pos = positions.get(nodeId) || { x: 0, y: 0 };
    
    const style = nodeData.style;
    const fillColor = style?.backgroundColor || style?.fillColor || "#6b7280";
    const textColor = style?.textColor || "#ffffff";
    const borderColor = style?.borderColor || "#374151";
    
    let shape = style?.shape || "round_rectangle";
    if (shape === "rounded_rectangle") {
      shape = "round_rectangle";
    }
    
    const shapeBody = {
      data: {
        // Adicionar marcador discreto no final do conteúdo (ID compacto)
        content: nodeData.label.substring(0, 4096) + `${SYSTEM_MARKER}${fullToCompactId.get(nodeId)}${MARKER_END}`,
        shape: shape
      },
      style: {
        fillColor: fillColor,
        textAlign: "left",
        textAlignVertical: "top",
        fontSize: "14",
        fontFamily: "arial",
        color: textColor,
        borderColor: borderColor,
        borderWidth: "2",
        borderStyle: "normal"
      },
      position: {
        x: pos.x,
        y: pos.y
      },
      geometry: {
        width: LAYOUT.nodeWidth,
        height: LAYOUT.nodeHeight
      }
    };

    try {
      const response = await fetchWithZapier(`${MIRO_API_BASE}/shapes`, {
        method: 'POST',
        headers: miroHeaders,
        body: JSON.stringify(shapeBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        debug.push(`Error creating shape for ${nodeId}: ${errorText.substring(0, 200)}`);
        errors++;
        continue;
      }
      
      const shapeData = await response.json();
      
      if (shapeData.id) {
        miroNodeIds.set(nodeId, shapeData.id);
        miroIdToNodeId.set(shapeData.id, nodeId);
        nodesCreated++;
        debug.push(`Created new node: ${nodeId} -> Miro ID: ${shapeData.id}`);
      }
    } catch (err) {
      debug.push(`Error creating shape for ${nodeId}: ${err.message}`);
      errors++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // ==============================================================
  // SINCRONIZAR CONECTORES
  // ==============================================================
  
  // Mapear conectores existentes por elementos que conectam
  const existingConnectorMap = new Map(); // "miroId1->miroId2" -> connector
  
  for (const connector of existingElements.connectors) {
    if (connector.startItem?.id && connector.endItem?.id) {
      const key = `${connector.startItem.id}->${connector.endItem.id}`;
      existingConnectorMap.set(key, connector);
    }
  }
  
  // Identificar conectores do sistema (aqueles que conectam nós do sistema)
  const systemConnectors = new Set();
  
  for (const [key, connector] of existingConnectorMap) {
    const [startMiroId, endMiroId] = key.split('->');
    
    // Se ambos os elementos são do sistema, o conector também é
    if (miroIdToNodeId.has(startMiroId) && miroIdToNodeId.has(endMiroId)) {
      systemConnectors.add(connector);
    }
  }
  
  debug.push(`Found ${systemConnectors.size} system connectors out of ${existingElements.connectors.length} total connectors`);
  
  // Deletar conectores obsoletos do sistema
  for (const connector of systemConnectors) {
    const startNodeId = miroIdToNodeId.get(connector.startItem.id);
    const endNodeId = miroIdToNodeId.get(connector.endItem.id);
    
    // Verificar se esta conexão ainda existe no banco
    const connectionExists = parsedData.edges.some(edge => 
      edge.source === startNodeId && edge.target === endNodeId
    );
    
    if (!connectionExists) {
      try {
        await fetchWithZapier(`${MIRO_API_BASE}/items/${connector.id}`, {
          method: 'DELETE',
          headers: miroHeaders
        });
        debug.push(`Deleted obsolete connector: ${startNodeId}->${endNodeId}`);
      } catch (err) {
        debug.push(`Error deleting connector: ${err}`);
      }
    }
  }
  
  // Criar conectores faltantes
  let connectorsCreated = 0;
  let connectorsSkipped = 0;
  let connectorErrors = 0;
  
  for (const edge of parsedData.edges) {
    const fromMiroId = miroNodeIds.get(edge.source);
    const toMiroId = miroNodeIds.get(edge.target);
    
    if (!fromMiroId || !toMiroId) {
      debug.push(`Missing nodes for connector: ${edge.source}->${edge.target}`);
      connectorErrors++;
      continue;
    }
    
    // Verificar se o conector já existe
    const connectorKey = `${fromMiroId}->${toMiroId}`;
    if (existingConnectorMap.has(connectorKey)) {
      connectorsSkipped++;
      debug.push(`Connector already exists: ${edge.source}->${edge.target}`);
      continue;
    }
    
    // Criar o conector
    const connectorBody = {
      startItem: {
        id: fromMiroId,
        position: { x: "50%", y: "100%" }
      },
      endItem: {
        id: toMiroId,
        position: { x: "50%", y: "0%" }
      },
      style: {
        strokeColor: "#6b7280",
        strokeWidth: "2",
        strokeStyle: "normal",
        startStrokeCap: "none",
        endStrokeCap: "stealth"
      },
      shape: "elbowed",
      captions: []
      // Conectores serão identificados pelos IDs dos elementos que conectam
    };

    try {
      const response = await fetchWithZapier(`${MIRO_API_BASE}/connectors`, {
        method: 'POST',
        headers: miroHeaders,
        body: JSON.stringify(connectorBody)
      });
      
      if (response.ok) {
        connectorsCreated++;
        debug.push(`Created connector: ${edge.source}->${edge.target}`);
      } else {
        const errorText = await response.text();
        debug.push(`Connector API error ${edge.source}->${edge.target}: ${errorText.substring(0, 200)}`);
        connectorErrors++;
      }
    } catch (err) {
      debug.push(`Connector exception ${edge.source}->${edge.target}: ${err.message}`);
      connectorErrors++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // ==============================================================
  // RESULTADO FINAL
  // ==============================================================
  
  const boardUrl = `https://miro.com/app/board/${miroBoardId}/`;
  const metadata = parsedData.metadata || {};
  
  let resultMessage = `Sync completed successfully!\n\n`;
  resultMessage += `📊 Database: ${metadata.databaseName || 'Unknown'}\n\n`;
  
  resultMessage += `🔄 Nodes:\n`;
  resultMessage += `  • Created: ${nodesCreated}\n`;
  resultMessage += `  • Updated: ${nodesUpdated}\n`;
  resultMessage += `  • Deleted: ${nodesDeleted}\n`;
  resultMessage += `  • Preserved: ${existingElements.others.length} manual elements\n\n`;
  
  resultMessage += `🔗 Connectors:\n`;
  resultMessage += `  • Created: ${connectorsCreated}\n`;
  resultMessage += `  • Kept: ${connectorsSkipped}\n`;
  
  if (errors > 0 || connectorErrors > 0) {
    resultMessage += `\n⚠️ Errors: ${errors} shapes, ${connectorErrors} connectors\n`;
  }
  
  resultMessage += `\n🔗 View at: ${boardUrl}`;
  
  return {
    result: resultMessage,
    debugInfo: debug.join('\n')
  };
}