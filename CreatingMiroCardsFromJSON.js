export async function createCardsOnMiroBoard({
    miroBoardId,
    miroAccessToken,
    DataJson,
    clearBoard  // Mantido apenas para compatibilidade - completamente ignorado
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
    const SYSTEM_MARKER = '\n\n[SYS-ID:';
    const MARKER_END = ']';
    
    // Função para criar ID mais simples e previsível
    function getSimpleId(fullId) {
      return fullId.replace(/_/g, '-');
    }
  
    // Layout configuration
    const LAYOUT = {
      nodeWidth: 350,
      nodeHeight: 250,
      horizontalSpacing: 400,
      verticalSpacing: 350,
      startX: 0,
      startY: -1000
    };
  
    // Parse the DataJson
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
  
    // Validate structure
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
    // CRIAR MAPEAMENTO DE IDs
    // ==============================================================
    
    const idMapping = new Map();
    
    parsedData.nodes.forEach(node => {
      const simpleId = getSimpleId(node.id);
      idMapping.set(simpleId, node.id);
      idMapping.set(node.id, node.id);
    });
    
    debug.push(`Created ID mappings for ${parsedData.nodes.length} nodes`);
  
    // Função auxiliar para extrair ID do sistema do conteúdo
    function extractSystemId(item) {
      if (!item.data?.content) {
        return null;
      }
      
      const content = item.data.content;
      
      const markers = [
        SYSTEM_MARKER,
        '[SYS-ID:',
        'SYS-ID:',
        '[id:',
      ];
      
      let markerStart = -1;
      let usedMarker = null;
      
      for (const marker of markers) {
        markerStart = content.indexOf(marker);
        if (markerStart !== -1) {
          usedMarker = marker;
          break;
        }
      }
      
      if (markerStart === -1) {
        return null;
      }
      
      const idStart = markerStart + usedMarker.length;
      const idEnd = content.indexOf(MARKER_END, idStart);
      
      if (idEnd === -1) {
        const endMarkers = [']', ')', '}', '\n', '<'];
        for (const endMarker of endMarkers) {
          const altEnd = content.indexOf(endMarker, idStart);
          if (altEnd !== -1) {
            const extractedId = content.substring(idStart, altEnd).trim();
            const originalId = idMapping.get(extractedId) || extractedId;
            return originalId;
          }
        }
        return null;
      }
      
      const extractedId = content.substring(idStart, idEnd).trim();
      const originalId = idMapping.get(extractedId) || extractedId;
      
      return originalId;
    }
  
    // ==============================================================
    // BUSCAR ELEMENTOS EXISTENTES
    // ==============================================================
    
    const existingElements = {
      shapes: new Map(),
      connectors: [],
      others: []
    };
    
    const miroIdToNodeId = new Map();
  
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
  
      debug.push(`Found ${allItems.length} items on board`);
      
      // Buscar conectores especificamente
      let allConnectors = [];
      cursor = null;
      
      try {
        do {
          const url = cursor 
            ? `${MIRO_API_BASE}/connectors?limit=50&cursor=${cursor}`
            : `${MIRO_API_BASE}/connectors?limit=50`;
            
          const response = await fetchWithZapier(url, {
            method: 'GET',
            headers: miroHeaders
          });
          
          if (!response.ok) {
            debug.push(`Warning: Could not fetch connectors`);
            break;
          }
          
          const data = await response.json();
          allConnectors = allConnectors.concat(data.data || []);
          cursor = data.cursor;
          
        } while (cursor);
        
        debug.push(`Found ${allConnectors.length} connectors on board`);
      } catch (err) {
        debug.push(`Could not fetch connectors: ${err.message}`);
      }
      
      // Classificar items existentes
      for (const item of allItems) {
        if (item.type === 'shape') {
          const systemId = extractSystemId(item);
          
          if (systemId) {
            existingElements.shapes.set(systemId, item);
            miroIdToNodeId.set(item.id, systemId);
          } else {
            existingElements.others.push(item);
          }
        }
      }
      
      existingElements.connectors = allConnectors;
      
      debug.push(`System nodes found: ${existingElements.shapes.size}`);
      debug.push(`Connectors found: ${existingElements.connectors.length}`);
      debug.push(`Manual elements: ${existingElements.others.length}`);
      
    } catch (err) {
      debug.push(`Error fetching existing elements: ${err.message}`);
      debug.push(`Will create all elements as new`);
    }
  
    // Process nodes and build hierarchy from edges
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
  
    // Process all nodes
    parsedData.nodes.forEach(node => {
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
  
    debug.push(`Processed nodes map has ${nodes.size} entries`);
  
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
  
    // Calculate positions
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
        
        const existingShape = existingElements.shapes.get(nodeId);
        if (existingShape && existingShape.position) {
          positions.set(nodeId, { 
            x: existingShape.position.x, 
            y: existingShape.position.y 
          });
          
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
          
          return;
        }
        
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
    // IDENTIFICAR OPERAÇÕES NECESSÁRIAS
    // ==============================================================
    
    const toCreate = new Set();
    const toUpdate = new Set();
    const toDelete = new Set();
  
    for (const [nodeId, nodeData] of nodes) {
      if (existingElements.shapes.has(nodeId)) {
        toUpdate.add(nodeId);
      } else {
        toCreate.add(nodeId);
      }
    }
  
    for (const [nodeId] of existingElements.shapes) {
      if (!nodes.has(nodeId)) {
        toDelete.add(nodeId);
      }
    }
  
    debug.push(`\n=== Operation Summary ===`);
    debug.push(`Nodes to CREATE: ${toCreate.size}`);
    debug.push(`Nodes to UPDATE: ${toUpdate.size}`);
    debug.push(`Nodes to DELETE: ${toDelete.size}`);
  
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
  
    // Adicionar ao mapa principal para poder usar com conectores
    for (const nodeId of toUpdate) {
      const existingShape = existingElements.shapes.get(nodeId);
      if (existingShape) {
        miroNodeIds.set(nodeId, existingShape.id);
        miroIdToNodeId.set(existingShape.id, nodeId);
      }
    }
    
    // 2. ATUALIZAR nós existentes (apenas conteúdo e estilo)
    for (const nodeId of toUpdate) {
      const nodeData = nodes.get(nodeId);
      const existingShape = existingElements.shapes.get(nodeId);
      
      if (!nodeData || !existingShape) continue;
      
      const style = nodeData.style;
      const fillColor = style?.backgroundColor || style?.fillColor || "#6b7280";
      const textColor = style?.textColor || "#ffffff";
      const borderColor = style?.borderColor || "#374151";
      
      const updateBody = {
        data: {
          content: nodeData.label.substring(0, 4000) + `${SYSTEM_MARKER}${getSimpleId(nodeId)}${MARKER_END}`
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
          content: nodeData.label.substring(0, 4000) + `${SYSTEM_MARKER}${getSimpleId(nodeId)}${MARKER_END}`,
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
    
    const existingConnectorMap = new Map();
    
    for (const connector of existingElements.connectors) {
      if (connector.startItem?.id && connector.endItem?.id) {
        const key = `${connector.startItem.id}->${connector.endItem.id}`;
        existingConnectorMap.set(key, connector);
      }
    }
    
    debug.push(`\nExisting connectors mapped: ${existingConnectorMap.size}`);
    
    const systemConnectors = new Set();
    
    for (const [key, connector] of existingConnectorMap) {
      const [startMiroId, endMiroId] = key.split('->');
      
      if (miroIdToNodeId.has(startMiroId) && miroIdToNodeId.has(endMiroId)) {
        systemConnectors.add(connector);
      }
    }
    
    debug.push(`System connectors identified: ${systemConnectors.size}`);
    
    let connectorsDeleted = 0;
    for (const connector of systemConnectors) {
      const startNodeId = miroIdToNodeId.get(connector.startItem.id);
      const endNodeId = miroIdToNodeId.get(connector.endItem.id);
      
      const connectionExists = parsedData.edges.some(edge => 
        edge.source === startNodeId && edge.target === endNodeId
      );
      
      if (!connectionExists) {
        try {
          await fetchWithZapier(`${MIRO_API_BASE}/connectors/${connector.id}`, {
            method: 'DELETE',
            headers: miroHeaders
          });
          connectorsDeleted++;
          debug.push(`Deleted obsolete connector: ${startNodeId}->${endNodeId}`);
        } catch (err) {
          debug.push(`Error deleting connector: ${err}`);
        }
      }
    }
    
    if (connectorsDeleted > 0) {
      debug.push(`Deleted ${connectorsDeleted} obsolete connectors`);
    }
    
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
      
      const connectorKey = `${fromMiroId}->${toMiroId}`;
      if (existingConnectorMap.has(connectorKey)) {
        connectorsSkipped++;
        continue;
      }
      
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
      };
  
      try {
        const response = await fetchWithZapier(`${MIRO_API_BASE}/connectors`, {
          method: 'POST',
          headers: miroHeaders,
          body: JSON.stringify(connectorBody)
        });
        
        if (response.ok) {
          connectorsCreated++;
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
    
    debug.push(`\nConnector Summary:`);
    debug.push(`- Created: ${connectorsCreated}`);
    debug.push(`- Skipped (already exist): ${connectorsSkipped}`);
    debug.push(`- Deleted: ${connectorsDeleted}`);
    debug.push(`- Errors: ${connectorErrors}`);
  
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
    
    if (connectorsDeleted > 0) {
      resultMessage += `  • Deleted: ${connectorsDeleted}\n`;
    }
    
    if (errors > 0 || connectorErrors > 0) {
      resultMessage += `\n⚠️ Errors: ${errors} shapes, ${connectorErrors} connectors\n`;
    }
    
    resultMessage += `\n🔗 View at: ${boardUrl}`;
    
    return {
      result: resultMessage,
      debugInfo: debug.join('\n')
    };
  }