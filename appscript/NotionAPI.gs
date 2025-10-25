// ==================== NOTION API INTEGRATION ====================
// Functions for interacting with Notion API

// Fetch page details from Notion
function fetchNotionPage(pageId) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
    
    if (!apiKey) {
      throw new Error('NOTION_API_KEY not found in script properties');
    }
    
    debugLog('📄 Fetching Notion page details', { pageId: pageId });
    
    const url = `${NOTION_API_BASE_URL}/pages/${pageId}`;
    
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    debugLog('📄 Notion page response', { 
      statusCode: responseCode,
      responseLength: responseText.length 
    });
    
    if (responseCode !== 200) {
      throw new Error(`Notion API error (${responseCode}): ${responseText}`);
    }
    
    const pageData = JSON.parse(responseText);
    
    // Extract title from properties
    let title = 'Untitled';
    if (pageData.properties) {
      // Look for title property (could be named differently)
      const titleProperty = Object.values(pageData.properties).find(prop => 
        prop.type === 'title' && prop.title && prop.title.length > 0
      );
      
      if (titleProperty) {
        title = titleProperty.title.map(t => t.plain_text).join('');
      }
    }
    
    // If no title found in properties, try the object itself
    if (title === 'Untitled' && pageData.title) {
      if (Array.isArray(pageData.title)) {
        title = pageData.title.map(t => t.plain_text || t.text?.content || '').join('');
      }
    }
    
    const result = {
      id: pageData.id,
      title: title || 'Untitled',
      url: pageData.url,
      created_time: pageData.created_time,
      last_edited_time: pageData.last_edited_time,
      properties: pageData.properties,
      parent: pageData.parent,
      archived: pageData.archived
    };
    
    debugLog('✅ Page details fetched successfully', { 
      title: result.title,
      id: result.id 
    });
    
    return result;
    
  } catch (error) {
    debugLog('❌ Error fetching Notion page', { 
      pageId: pageId,
      error: error.toString() 
    });
    throw error;
  }
}

// Fetch page content (blocks) from Notion
function fetchNotionPageContent(pageId) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
    
    if (!apiKey) {
      throw new Error('NOTION_API_KEY not found in script properties');
    }
    
    debugLog('📝 Fetching Notion page content', { pageId: pageId });
    
    let allBlocks = [];
    let nextCursor = null;
    let pageCount = 0;
    const maxPages = 10; // Prevent infinite loops
    
    do {
      pageCount++;
      if (pageCount > maxPages) {
        debugLog('⚠️ Maximum page limit reached, stopping fetch');
        break;
      }
      
      let url = `${NOTION_API_BASE_URL}/blocks/${pageId}/children?page_size=100`;
      if (nextCursor) {
        url += `&start_cursor=${nextCursor}`;
      }
      
      const response = UrlFetchApp.fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      });
      
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      if (responseCode !== 200) {
        throw new Error(`Notion API error (${responseCode}): ${responseText}`);
      }
      
      const data = JSON.parse(responseText);
      
      if (data.results && Array.isArray(data.results)) {
        allBlocks = allBlocks.concat(data.results);
      }
      
      nextCursor = data.has_more ? data.next_cursor : null;
      
      debugLog(`📄 Fetched page ${pageCount}`, { 
        blocksInPage: data.results?.length || 0,
        totalBlocks: allBlocks.length,
        hasMore: data.has_more 
      });
      
    } while (nextCursor);
    
    debugLog('✅ Page content fetched successfully', { 
      totalBlocks: allBlocks.length,
      pages: pageCount 
    });
    
    // Convert blocks to readable text
    const content = convertBlocksToText(allBlocks);
    
    return content;
    
  } catch (error) {
    debugLog('❌ Error fetching Notion page content', { 
      pageId: pageId,
      error: error.toString() 
    });
    throw error;
  }
}

// Fetch children blocks recursively
function fetchBlockChildren(blockId, level = 0) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
    
    if (!apiKey || level > 3) { // Prevent infinite recursion
      return [];
    }
    
    debugLog('📄 Fetching children blocks', { blockId: blockId, level: level });
    
    const url = `${NOTION_API_BASE_URL}/blocks/${blockId}/children?page_size=100`;
    
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      debugLog('⚠️ Error fetching children blocks', { 
        blockId: blockId,
        statusCode: responseCode,
        error: responseText 
      });
      return [];
    }
    
    const data = JSON.parse(responseText);
    return data.results || [];
    
  } catch (error) {
    debugLog('❌ Error fetching children blocks', { 
      blockId: blockId,
      error: error.toString() 
    });
    return [];
  }
}

// Convert Notion blocks to readable text with children support
function convertBlocksToText(blocks, level = 0) {
  if (!Array.isArray(blocks)) {
    return '';
  }
  
  let content = '';
  const indent = '  '.repeat(level); // 2 spaces per level
  
  blocks.forEach(block => {
    try {
      const blockText = extractTextFromBlock(block);
      if (blockText) {
        content += indent + blockText + '\n';
        
        // Check if this block has children and fetch them
        if (block.has_children && level < 3) { // Prevent deep nesting
          const children = fetchBlockChildren(block.id, level + 1);
          if (children.length > 0) {
            const childrenText = convertBlocksToText(children, level + 1);
            if (childrenText.trim()) {
              content += childrenText;
            }
          }
        }
      }
    } catch (error) {
      debugLog('⚠️ Error processing block', { 
        blockId: block.id,
        blockType: block.type,
        error: error.toString() 
      });
      
      // Log the issue but continue processing
      logContentIssue({
        type: 'block_processing_error',
        description: `Error processing ${block.type} block`,
        blockId: block.id,
        errorMessage: error.toString()
      });
      
      content += indent + `[Error processing ${block.type} block: ${block.id}]\n`;
    }
  });
  
  return content;
}

// Extract text from a single Notion block
function extractTextFromBlock(block) {
  if (!block || !block.type) {
    return '';
  }
  
  const blockType = block.type;
  const blockData = block[blockType];
  
  if (!blockData) {
    logContentIssue({
      type: 'unsupported_block',
      description: `Unsupported block type: ${blockType}`,
      blockId: block.id
    });
    return `[Unsupported block type: ${blockType}]`;
  }
  
  switch (blockType) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
    case 'callout':
      return extractRichText(blockData.rich_text);
    
    case 'code':
      const codeText = extractRichText(blockData.rich_text);
      const language = blockData.language || 'text';
      return `\`\`\`${language}\n${codeText}\n\`\`\``;
    
    case 'to_do':
      const todoText = extractRichText(blockData.rich_text);
      const checked = blockData.checked ? '[x]' : '[ ]';
      return `${checked} ${todoText}`;
    
    case 'toggle':
      return extractRichText(blockData.rich_text);
    
    case 'table':
      return '[Table content - structure preserved]';
    
    case 'table_row':
      if (blockData.cells && Array.isArray(blockData.cells)) {
        const cellTexts = blockData.cells.map(cell => extractRichText(cell));
        return '| ' + cellTexts.join(' | ') + ' |';
      }
      return '[Table row]';
    
    case 'divider':
      return '---';
    
    case 'file':
    case 'image':
    case 'video':
    case 'pdf':
      const fileUrl = blockData.file?.url || blockData.external?.url || '';
      const caption = extractRichText(blockData.caption || []);
      return `[${blockType.toUpperCase()}: ${fileUrl}]${caption ? ` ${caption}` : ''}`;
    
    case 'bookmark':
    case 'link_preview':
      const bookmarkUrl = blockData.url || '';
      const bookmarkCaption = extractRichText(blockData.caption || []);
      return `[BOOKMARK: ${bookmarkUrl}]${bookmarkCaption ? ` ${bookmarkCaption}` : ''}`;
    
    case 'embed':
      const embedUrl = blockData.url || '';
      return `[EMBED: ${embedUrl}]`;
    
    case 'equation':
      return `[EQUATION: ${blockData.expression || ''}]`;
    
    case 'breadcrumb':
      return '[Breadcrumb]';
    
    case 'table_of_contents':
      return '[Table of Contents]';
    
    case 'column_list':
    case 'column':
      return `[${blockType.replace('_', ' ').toUpperCase()}]`;
    
    case 'synced_block':
      return '[Synced Block]';
    
    case 'template':
      return '[Template Block]';
    
    case 'child_page':
      return `[CHILD PAGE: ${blockData.title}]`;
    
    case 'child_database':
      return `[CHILD DATABASE: ${blockData.title}]`;
    
    default:
      logContentIssue({
        type: 'unsupported_block',
        description: `Unsupported block type: ${blockType}`,
        blockId: block.id
      });
      return `[Unsupported block type: ${blockType}]`;
  }
}

// Extract text from Notion rich text array
function extractRichText(richTextArray) {
  if (!Array.isArray(richTextArray)) {
    return '';
  }
  
  return richTextArray
    .map(textObj => {
      if (!textObj || typeof textObj !== 'object') {
        return '';
      }
      
      // Handle different text object types
      if (textObj.type === 'text') {
        return textObj.text?.content || '';
      } else if (textObj.type === 'mention') {
        // Handle mentions (users, pages, etc.)
        if (textObj.mention?.type === 'user') {
          return `@${textObj.mention.user?.name || 'User'}`;
        } else if (textObj.mention?.type === 'page') {
          return `[Page: ${textObj.mention.page?.id || 'Unknown'}]`;
        } else {
          return textObj.plain_text || '[Mention]';
        }
      } else if (textObj.type === 'equation') {
        return `[Equation: ${textObj.equation?.expression || ''}]`;
      } else {
        // Fallback to plain_text if available
        return textObj.plain_text || '';
      }
    })
    .join('');
}

// Extract page ID from various formats
function extractPageIdFromRequest(requestData) {
  if (!requestData) {
    return null;
  }
  
  // Try different possible locations for page ID
  if (requestData.pageId) {
    return requestData.pageId;
  }
  
  if (requestData.data && requestData.data.id) {
    return requestData.data.id;
  }
  
  if (requestData.id) {
    return requestData.id;
  }
  
  if (requestData.page_id) {
    return requestData.page_id;
  }
  
  return null;
}

// Search Notion pages (if needed)
function searchNotionPages(query, options = {}) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
    
    if (!apiKey) {
      throw new Error('NOTION_API_KEY not found in script properties');
    }
    
    debugLog('🔍 Searching Notion pages', { query: query });
    
    const payload = {
      query: query,
      page_size: options.pageSize || 10
    };
    
    if (options.filter) {
      payload.filter = options.filter;
    }
    
    if (options.sort) {
      payload.sort = options.sort;
    }
    
    const response = UrlFetchApp.fetch(`${NOTION_API_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error(`Notion search error (${responseCode}): ${responseText}`);
    }
    
    const data = JSON.parse(responseText);
    
    debugLog('✅ Notion search completed', { 
      resultsCount: data.results?.length || 0 
    });
    
    return data.results || [];
    
  } catch (error) {
    debugLog('❌ Error searching Notion pages', { 
      query: query,
      error: error.toString() 
    });
    throw error;
  }
}

// Get database entries (if needed)
function getNotionDatabase(databaseId, options = {}) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
    
    if (!apiKey) {
      throw new Error('NOTION_API_KEY not found in script properties');
    }
    
    debugLog('📊 Fetching Notion database', { databaseId: databaseId });
    
    const payload = {
      page_size: options.pageSize || 100
    };
    
    if (options.filter) {
      payload.filter = options.filter;
    }
    
    if (options.sorts) {
      payload.sorts = options.sorts;
    }
    
    const response = UrlFetchApp.fetch(`${NOTION_API_BASE_URL}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error(`Notion database error (${responseCode}): ${responseText}`);
    }
    
    const data = JSON.parse(responseText);
    
    debugLog('✅ Notion database fetched', { 
      resultsCount: data.results?.length || 0 
    });
    
    return data.results || [];
    
  } catch (error) {
    debugLog('❌ Error fetching Notion database', { 
      databaseId: databaseId,
      error: error.toString() 
    });
    throw error;
  }
}