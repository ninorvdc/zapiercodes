// ==================== UTILITY FUNCTIONS ====================
// General utility functions for debugging, content processing, and helper functions

// Debug logging function
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  let logEntry = `[${timestamp}] ${message}`;
  
  if (data) {
    logEntry += `\n[${timestamp}] DATA: ${JSON.stringify(data, null, 2)}`;
  }
  
  if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE && typeof DEBUG_LOGS !== 'undefined') {
    DEBUG_LOGS.push(logEntry);
  }
  
  console.log(logEntry);
}

// Manual function to save debug logs to file (call this explicitly when needed)
function saveDebugLogs(pageId = null) {
  try {
    if (typeof DEBUG_LOGS === 'undefined' || DEBUG_LOGS.length === 0) {
      debugLog('No debug logs to save');
      return null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const debugFileName = pageId ? 
      `debug_${pageId}_${timestamp}.txt` : 
      `debug_${timestamp}.txt`;
    
    const debugContent = DEBUG_LOGS.join('\n\n');
    const file = saveToGoogleDrive(debugContent, debugFileName);
    
    console.log(`Debug logs saved to: ${debugFileName}`);
    return file;
  } catch (error) {
    console.log(`Failed to save debug log: ${error.toString()}`);
    return null;
  }
}

// Get existing debug file content or create new
function getDebugFileContent(fileName) {
  try {
    const files = DriveApp.getFilesByName(fileName);
    if (files.hasNext()) {
      const file = files.next();
      return file.getBlob().getDataAsString();
    }
    return `DEBUG LOG - ${new Date().toISOString()}\n=================\n\n`;
  } catch (error) {
    return `DEBUG LOG - ${new Date().toISOString()}\n=================\n\n`;
  }
}

// Rate limiting utility for Google Apps Script (no setTimeout available)
function sleep(ms) {
  debugLog(`Sleeping for ${ms}ms to respect rate limits`);
  Utilities.sleep(ms);
}

// Log content issues found during processing
function logContentIssue(issue) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp: timestamp,
    type: issue.type || 'unknown',
    description: issue.description || 'Unknown issue',
    blockId: issue.blockId || null,
    url: issue.url || null,
    errorMessage: issue.errorMessage || null,
    rawContent: issue.rawContent || null
  };
  
  CONTENT_ISSUES.push(logEntry);
  
  // Also add to debug logs
  debugLog(`CONTENT_ISSUE [${logEntry.type}]: ${logEntry.description}`, {
    blockId: logEntry.blockId,
    url: logEntry.url,
    error: logEntry.errorMessage
  });
  
  console.log(`⚠️ Content Issue [${logEntry.type}]: ${logEntry.description}`);
}

// Clean content for LLM processing - remove error blocks and problematic content
function cleanContentForLLM(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  
  let cleanedContent = content;
  let issuesFound = 0;
  
  // Patterns to identify and remove problematic content
  const problemPatterns = [
    // Unsupported block types
    {
      pattern: /\[Unsupported block type:[^\]]+\]/g,
      type: 'unsupported_block',
      description: 'Unsupported Notion block type'
    },
    // Notion API errors
    {
      pattern: /\[Notion Page:[^-]+ - Error:[^\]]+\]/g,
      type: 'notion_api_error',
      description: 'Notion API access error'
    },
    // Notion block content errors
    {
      pattern: /\[Notion Block Content[^:]*:[^-]+ - Error:[^\]]+\]/g,
      type: 'notion_block_error',
      description: 'Notion block content error'
    },
    // Empty or failed embeds
    {
      pattern: /\[Embed:[^\]]+\]\s*\[End of Notion Block\]/g,
      type: 'empty_embed',
      description: 'Empty or inaccessible embed'
    },
    // Table rows without content
    {
      pattern: /\s*\[Unsupported block type: table_row\]\s*/g,
      type: 'table_row',
      description: 'Unsupported table row'
    },
    // Column layouts
    {
      pattern: /\s*\[Unsupported block type: column[^\]]*\]\s*/g,
      type: 'column_layout',
      description: 'Unsupported column layout'
    }
  ];
  
  // Apply each pattern and log issues
  problemPatterns.forEach(({ pattern, type, description }) => {
    const matches = cleanedContent.match(pattern);
    if (matches) {
      matches.forEach(match => {
        logContentIssue({
          type: type,
          description: description,
          rawContent: match.substring(0, 200) // First 200 chars for reference
        });
        issuesFound++;
      });
      
      // Remove the problematic content
      cleanedContent = cleanedContent.replace(pattern, '');
    }
  });
  
  // Clean up extra whitespace and newlines
  cleanedContent = cleanedContent
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines to double
    .replace(/^\s+|\s+$/g, '') // Trim
    .replace(/\s{3,}/g, ' '); // Multiple spaces to single
  
  if (issuesFound > 0) {
    debugLog(`Content cleaning completed: ${issuesFound} issues found and removed`);
    debugLog(`Original length: ${content.length}, Cleaned length: ${cleanedContent.length}`);
  }
  
  return cleanedContent;
}

// Save content issues log to Drive
function saveContentIssuesLog(pageId) {
  if (CONTENT_ISSUES.length === 0) {
    return null;
  }
  
  const timestamp = new Date().toISOString();
  const logContent = `# Content Issues Log for Page ${pageId}
Generated: ${timestamp}
Total Issues: ${CONTENT_ISSUES.length}

## Issues Summary
${CONTENT_ISSUES.map(issue => `
### ${issue.type.toUpperCase()} - ${issue.timestamp}
**Description:** ${issue.description}
${issue.blockId ? `**Block ID:** ${issue.blockId}` : ''}
${issue.url ? `**URL:** ${issue.url}` : ''}
${issue.errorMessage ? `**Error:** ${issue.errorMessage}` : ''}
${issue.rawContent ? `**Content Sample:** ${issue.rawContent}` : ''}
`).join('\n')}

## Raw Issues Data
${JSON.stringify(CONTENT_ISSUES, null, 2)}
`;

  const fileName = `content_issues_${pageId}_${timestamp.replace(/[:.]/g, '-')}.md`;
  try {
    const file = saveToGoogleDrive(logContent, fileName);
    debugLog(`Content issues log saved: ${fileName}`);
    return file;
  } catch (error) {
    debugLog('Error saving content issues log:', error);
    return null;
  }
}

// Function to chunk large content for better rate limit handling
function chunkContent(content, maxChunkSize = CHUNK_SIZE) {
  if (typeof content !== 'string') {
    debugLog('chunkContent received invalid content value:', {
      type: typeof content,
      hasValue: !!content
    });
    return [];
  }

  if (content.length <= maxChunkSize) {
    return [content];
  }

  const chunks = [];
  let currentIndex = 0;

  while (currentIndex < content.length) {
    let chunkEnd = currentIndex + maxChunkSize;

    if (chunkEnd < content.length) {
      const paragraphBreak = content.lastIndexOf('\n\n', chunkEnd);
      if (paragraphBreak > currentIndex + maxChunkSize * 0.7) {
        chunkEnd = paragraphBreak;
      } else {
        const sentenceBreak = content.lastIndexOf('. ', chunkEnd);
        if (sentenceBreak > currentIndex + maxChunkSize * 0.7) {
          chunkEnd = sentenceBreak + 1;
        }
      }
    }

    chunks.push(content.substring(currentIndex, chunkEnd));
    currentIndex = chunkEnd;
  }

  return chunks;
}

// URL helper functions
function appendQueryParam(url, key, value) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

// Detect URL type (Google Doc, Sheet, Notion, etc)
function detectUrlType(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const urlPatterns = [
    {
      pattern: /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/,
      type: 'google_doc',
      extractId: match => match[1]
    },
    {
      pattern: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      type: 'google_sheet',
      extractId: match => match[1]
    },
    {
      pattern: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9-_]+)/,
      type: 'google_slides',
      extractId: match => match[1]
    },
    {
      pattern: /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/,
      type: 'google_drive_file',
      extractId: match => match[1]
    },
    {
      pattern: /notion\.so\/([a-zA-Z0-9-]+)/,
      type: 'notion_page',
      extractId: match => match[1]
    },
    {
      pattern: /loom\.com\/share\/([a-zA-Z0-9]+)/,
      type: 'loom_video',
      extractId: match => match[1]
    }
  ];

  for (const { pattern, type, extractId } of urlPatterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        type: type,
        id: extractId(match),
        url: url
      };
    }
  }

  return {
    type: 'external',
    url: url
  };
}

// Check if file exists in Drive folder
function checkFileExists(fileName) {
  // Always use the specific log folder
  const folder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
  
  const files = folder.getFilesByName(fileName);
  return {
    exists: files.hasNext(),
    file: files.hasNext() ? files.next() : null,
    folder: folder
  };
}

// Save content to Google Drive
function saveToGoogleDrive(content, fileName) {
  try {
    // Always use the specific log folder (not configurable anymore)
    const folder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
    
    // Check if file already exists to avoid duplicates
    const existingFiles = folder.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      const existingFile = existingFiles.next();
      existingFile.setContent(content);
      debugLog(`Updated existing file: ${fileName}`);
      return existingFile;
    } else {
      const blob = Utilities.newBlob(content, 'text/plain', fileName);
      const file = folder.createFile(blob);
      debugLog(`Created new file: ${fileName}`);
      return file;
    }
  } catch (error) {
    debugLog('Error saving to Google Drive:', error);
    throw error;
  }
}

// Update progress file with current status
function updateProgressFile(progressFileName, pageId, status) {
  try {
    // Always use the specific log folder
    const folder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
    const files = folder.getFilesByName(progressFileName);
    
    if (files.hasNext()) {
      const file = files.next();
      const currentContent = file.getBlob().getDataAsString();
      const updatedContent = currentContent + `\n${new Date().toISOString()}: ${status}`;
      file.setContent(updatedContent);
    }
  } catch (error) {
    debugLog('❌ Error updating progress file', { error: error.toString() });
  }
}

// ==================== PAGE STATUS CONTROL SYSTEM ====================

// Create or load page status control file
function loadPageStatusControl(pageId) {
  const statusFileName = `page_status_${pageId}.json`;
  
  try {
    // Always use the specific log folder
    const folder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
    
    const files = folder.getFilesByName(statusFileName);
    
    if (files.hasNext()) {
      // File exists, load it
      const file = files.next();
      const content = file.getBlob().getDataAsString();
      const status = JSON.parse(content);
      
      debugLog('📋 Loaded existing page status', { 
        pageId: pageId,
        fileName: statusFileName,
        status: status
      });
      
      return {
        status: status,
        file: file,
        fileName: statusFileName
      };
    } else {
      // File doesn't exist, will be created when needed
      debugLog('📋 No existing page status found', { 
        pageId: pageId,
        fileName: statusFileName
      });
      
      return {
        status: null,
        file: null,
        fileName: statusFileName,
        folder: folder
      };
    }
  } catch (error) {
    debugLog('❌ Error loading page status', { 
      pageId: pageId,
      error: error.toString()
    });
    return null;
  }
}

// Initialize page status control based on index
function initializePageStatusControl(pageId, index) {
  debugLog('🆕 Initializing page status control', { 
    pageId: pageId,
    totalItems: index.totalItems,
    subBlocksCount: index.subBlocks.length
  });
  
  const statusControl = {
    pageId: pageId,
    pageTitle: index.main.title,
    initialized: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    
    // Tracking structure
    tracking: {
      mainPage: {
        itemId: index.main.id,
        contentId: index.main.contentId,
        status: 'pending', // pending, processing, completed
        taskId: null,
        processedFile: null,
        completedAt: null
      },
      subBlocks: {},
      
      // Summary counters
      totalItems: index.totalItems,
      totalSubBlocks: index.subBlocks.length,
      completedItems: 0,
      pendingItems: index.totalItems
    },
    
    // Final processing
    finalProcessing: {
      allCompleted: false,
      finalSummaryCreated: false,
      webhookSent: false,
      finalSummaryFile: null,
      completedAt: null
    }
  };
  
  // Initialize sub-blocks tracking
  index.subBlocks.forEach((subBlock, index) => {
    statusControl.tracking.subBlocks[subBlock.id] = {
      itemId: subBlock.id,
      contentId: subBlock.contentId,
      sourceType: subBlock.sourceType,
      url: subBlock.url,
      title: subBlock.title,
      status: 'pending', // pending, processing, completed
      taskId: null,
      processedFile: null,
      completedAt: null
    };
  });
  
  // Save to file
  return savePageStatusControl(pageId, statusControl);
}

// Save page status control to file
function savePageStatusControl(pageId, statusControl) {
  const statusFileName = `page_status_${pageId}.json`;
  
  try {
    statusControl.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(statusControl, null, 2);
    
    // Always use the specific log folder
    const folder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
    
    // Check if file exists
    const files = folder.getFilesByName(statusFileName);
    let file;
    
    if (files.hasNext()) {
      // Update existing file
      file = files.next();
      file.setContent(content);
      debugLog('✅ Updated page status control file', { 
        pageId: pageId,
        fileName: statusFileName,
        completedItems: statusControl.tracking.completedItems,
        totalItems: statusControl.tracking.totalItems
      });
    } else {
      // Create new file
      file = folder.createFile(statusFileName, content, 'application/json');
      debugLog('✅ Created new page status control file', { 
        pageId: pageId,
        fileName: statusFileName,
        totalItems: statusControl.tracking.totalItems
      });
    }
    
    return {
      statusControl: statusControl,
      file: file,
      fileName: statusFileName
    };
    
  } catch (error) {
    debugLog('❌ Error saving page status control', { 
      pageId: pageId,
      error: error.toString()
    });
    return null;
  }
}

// Update item status in page control
function updateItemStatusInControl(pageId, itemId, contentType, taskId, status, processedFile = null) {
  debugLog('📝 Updating item status in control', { 
    pageId: pageId,
    itemId: itemId,
    contentType: contentType,
    status: status,
    taskId: taskId
  });
  
  const controlData = loadPageStatusControl(pageId);
  if (!controlData || !controlData.status) {
    debugLog('❌ No page status control found for update', { pageId: pageId });
    return null;
  }
  
  const statusControl = controlData.status;
  
  // Update the appropriate item
  if (contentType === 'main_page' && statusControl.tracking.mainPage.itemId === itemId) {
    const previousStatus = statusControl.tracking.mainPage.status;
    statusControl.tracking.mainPage.status = status;
    statusControl.tracking.mainPage.taskId = taskId;
    statusControl.tracking.mainPage.processedFile = processedFile;
    
    if (status === 'completed' && previousStatus !== 'completed') {
      statusControl.tracking.mainPage.completedAt = new Date().toISOString();
      statusControl.tracking.completedItems++;
      statusControl.tracking.pendingItems--;
      
      debugLog('✅ Main page marked as completed', { 
        pageId: pageId,
        completedItems: statusControl.tracking.completedItems,
        totalItems: statusControl.tracking.totalItems
      });
    }
    
  } else if (contentType === 'sub_block' && statusControl.tracking.subBlocks[itemId]) {
    const previousStatus = statusControl.tracking.subBlocks[itemId].status;
    statusControl.tracking.subBlocks[itemId].status = status;
    statusControl.tracking.subBlocks[itemId].taskId = taskId;
    statusControl.tracking.subBlocks[itemId].processedFile = processedFile;
    
    if (status === 'completed' && previousStatus !== 'completed') {
      statusControl.tracking.subBlocks[itemId].completedAt = new Date().toISOString();
      statusControl.tracking.completedItems++;
      statusControl.tracking.pendingItems--;
      
      debugLog('✅ Sub-block marked as completed', { 
        pageId: pageId,
        itemId: itemId,
        completedItems: statusControl.tracking.completedItems,
        totalItems: statusControl.tracking.totalItems
      });
    }
  } else {
    debugLog('⚠️ Item not found in status control', { 
      pageId: pageId,
      itemId: itemId,
      contentType: contentType
    });
    return null;
  }
  
  // Save updated status
  const saved = savePageStatusControl(pageId, statusControl);
  
  // Check if all items are completed
  if (statusControl.tracking.completedItems === statusControl.tracking.totalItems) {
    debugLog('🎉 All items completed for page!', { 
      pageId: pageId,
      completedItems: statusControl.tracking.completedItems,
      totalItems: statusControl.tracking.totalItems
    });
    
    // Trigger final processing
    return {
      ...saved,
      allCompleted: true,
      readyForFinalProcessing: true
    };
  }
  
  return {
    ...saved,
    allCompleted: false,
    readyForFinalProcessing: false
  };
}

// Check if all items are completed for a page
function checkPageCompletionStatus(pageId) {
  const controlData = loadPageStatusControl(pageId);
  if (!controlData || !controlData.status) {
    return {
      exists: false,
      completed: false,
      statusControl: null
    };
  }
  
  const statusControl = controlData.status;
  const allCompleted = statusControl.tracking.completedItems === statusControl.tracking.totalItems;
  
  return {
    exists: true,
    completed: allCompleted,
    statusControl: statusControl,
    completedItems: statusControl.tracking.completedItems,
    totalItems: statusControl.tracking.totalItems,
    pendingItems: statusControl.tracking.pendingItems
  };
}