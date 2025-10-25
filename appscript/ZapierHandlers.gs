// ==================== ZAPIER HANDLERS ====================
// All Zapier-specific functions including webhooks, callbacks, and polling

// Global doPost handler - routes requests appropriately
function doPost(e) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // FORCE LOG - Save to specific Drive folder as TXT file
  // Always clean previous log and save only the current one
  try {
    const targetFolderId = '193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ';
    
    // First, clean any existing webapp doPost logs in the folder
    try {
      const folder = DriveApp.getFolderById(targetFolderId);
      const existingLogs = folder.getFilesByName('current_webapp_dopost.txt');
      while (existingLogs.hasNext()) {
        const file = existingLogs.next();
        file.setTrashed(true);
        console.log('🧹 Cleaned previous webapp log file');
      }
    } catch (cleanError) {
      console.log('⚠️ Cleanup warning:', cleanError.toString());
      // Continue even if cleanup fails
    }
    
    // Extract structured data from POST content (XML tags + result)
    let extractedData = {
      pageId: null,
      taskId: null,
      itemId: null,
      rawFileName: null,
      rawFileId: null,
      contentType: null,
      contentId: null,
      result: null,
      rawContent: null
    };
    
    // Parse POST content to extract XML tags and result
    try {
      if (e.postData?.contents) {
        const content = e.postData.contents;
        
        // Extract XML-style tags
        const tagRegex = /<(\w+)>(.*?)<\/\1>/g;
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
          const [, tagName, tagValue] = match;
          if (extractedData.hasOwnProperty(tagName)) {
            extractedData[tagName] = tagValue;
          }
        }
        
        // Also check for single tags like <pageId>value</pageId> -> <pageId>value</pageid>
        extractedData.pageId = extractedData.pageId || extractTag(content, 'pageId') || extractTag(content, 'pageid');
        extractedData.taskId = extractedData.taskId || extractTag(content, 'taskId');
        extractedData.itemId = extractedData.itemId || extractTag(content, 'itemId') || extractTag(content, 'temId');
        extractedData.rawFileName = extractedData.rawFileName || extractTag(content, 'rawFileName');
        extractedData.rawFileId = extractedData.rawFileId || extractTag(content, 'rawFileId');
        extractedData.contentType = extractedData.contentType || extractTag(content, 'contentType');
        extractedData.contentId = extractedData.contentId || extractTag(content, 'contentId');
        extractedData.result = extractedData.result || extractTag(content, 'result');
        
        debugLog('📋 Extracted structured data from POST', extractedData);
      }
    } catch (parseError) {
      debugLog('⚠️ Error parsing POST content for tags', { error: parseError.toString() });
    }
    
    // Helper function to extract tag content
    function extractTag(content, tagName) {
      const regex = new RegExp(`<${tagName}>(.*?)<\\/${tagName}>`, 'i');
      const match = content.match(regex);
      return match ? match[1] : null;
    }

    const logContent = `=== WEBAPP DOPOST LOG ===
Timestamp: ${timestamp}
Method: webapp_dopost
Source: production_webapp
Content Length: ${e.contentLength || 0}
Content Type: ${e.postData?.type || 'unknown'}

=== EXTRACTED STRUCTURED DATA ===
Page ID: ${extractedData.pageId || 'Not found'}
Task ID: ${extractedData.taskId || 'Not found'}
Item ID: ${extractedData.itemId || 'Not found'}
Content Type: ${extractedData.contentType || 'Not found'}
Content ID: ${extractedData.contentId || 'Not found'}
Raw File Name: ${extractedData.rawFileName || 'Not found'}
Raw File ID: ${extractedData.rawFileId || 'Not found'}

=== LLM RESULT CONTENT ===
${extractedData.result ? extractedData.result.substring(0, 500) + (extractedData.result.length > 500 ? '...\n[TRUNCATED - Full content available in processing]' : '') : 'No result content found'}

=== URL PARAMETERS ===
${JSON.stringify(e.parameter || {}, null, 2)}

=== RAW POST CONTENT ===
${e.postData?.contents || 'No content'}

=== COMPLETE EVENT OBJECT ===
${JSON.stringify(e, null, 2)}

=== END OF LOG ===
Generated: ${new Date().toISOString()}`;
    
    // Save current log as TXT file in specified folder
    try {
      const folder = DriveApp.getFolderById(targetFolderId);
      const logFile = folder.createFile('current_webapp_dopost.txt', logContent, 'text/plain');
      
      console.log('✅ WEBAPP LOG saved to Drive folder');
      console.log(`📄 File ID: ${logFile.getId()}`);
      console.log(`📁 Folder ID: ${targetFolderId}`);
    } catch (driveError) {
      console.log('❌ Drive save failed:', driveError.toString());
      
      // Fallback: save to root Drive if folder access fails
      try {
        const logFile = DriveApp.createFile('current_webapp_dopost.txt', logContent, 'text/plain');
        console.log('⚠️ Saved to root Drive as fallback');
        console.log(`📄 File ID: ${logFile.getId()}`);
      } catch (rootError) {
        console.log('❌ Root Drive fallback also failed:', rootError.toString());
      }
    }
    
  } catch (logError) {
    console.log('❌ CRITICAL: Logging failed:', logError.toString());
  }
  
  // Drive NÃO funciona em webapp pública - apenas em testes internos
  // Comentando tentativas de Drive para evitar logs desnecessários
  /*
  try {
    DriveApp.getRootFolder().createFile(`WEBAPP_DOPOST_${timestamp}.txt`, `doPost via WEBAPP at ${timestamp}\nEvent: ${JSON.stringify(e, null, 2)}`);
    console.log('✅ Drive log saved (only works in internal tests)');
  } catch (driveError) {
    console.log('⚠️ Drive failed as expected in webapp context:', driveError.toString());
  }
  */
  
  try {
    console.log('🚀 doPost STARTED at ' + timestamp);
    
    // Extract headers/parameters from the request
    const headers = e.parameter || {};
    
    // Collect all debug info
    const debugInfo = [
      `=== doPost Started ${timestamp} ===`,
      `Event received: ${JSON.stringify(e, null, 2)}`,
      `Headers/Parameters: ${JSON.stringify(headers, null, 2)}`,
      ''
    ];
    
    if (!e || !e.postData || !e.postData.contents) {
      const msg = '❌ No POST data received';
      console.log(msg);
      debugInfo.push(msg);
      
      // Force save error to ROOT DRIVE
      try {
        DriveApp.getRootFolder().createFile(`WEBAPP_DOPOST_NO_DATA_${timestamp}.txt`, debugInfo.join('\n'));
      } catch (saveError) {
        console.log('Save error:', saveError.toString());
      }
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'No POST data received',
        timestamp: timestamp
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const postData = e.postData.contents;
    const msg1 = `📋 RAW POST DATA (${postData.length} chars): ${postData}`;
    console.log(msg1);
    debugInfo.push(msg1);
    debugInfo.push('');
    
    // First, try to extract XML tags (for Zapier LLM results)
    const extractedData = extractXMLTagsFromContent(postData);
    debugInfo.push(`=== EXTRACTED XML TAGS ===`);
    debugInfo.push(`Page ID: ${extractedData.pageId || 'Not found'}`);
    debugInfo.push(`Task ID: ${extractedData.taskId || 'Not found'}`);
    debugInfo.push(`Item ID: ${extractedData.itemId || 'Not found'}`);
    debugInfo.push(`Content Type: ${extractedData.contentType || 'Not found'}`);
    debugInfo.push(`Content ID: ${extractedData.contentId || 'Not found'}`);
    debugInfo.push(`Raw File Name: ${extractedData.rawFileName || 'Not found'}`);
    debugInfo.push(`Raw File ID: ${extractedData.rawFileId || 'Not found'}`);
    debugInfo.push('');
    debugInfo.push(`=== LLM RESULT CONTENT ===`);
    if (extractedData.result) {
      debugInfo.push(`Found result: ${extractedData.result.length} characters`);
      debugInfo.push(`First 200 chars: ${extractedData.result.substring(0, 200)}...`);
    } else {
      debugInfo.push('No result content found');
    }
    debugInfo.push('');
    
    let requestData;
    
    // Try to parse as JSON first
    try {
      requestData = JSON.parse(postData);
      const msg2 = `✅ PARSED AS JSON: ${JSON.stringify(requestData, null, 2)}`;
      console.log(msg2);
      debugInfo.push(msg2);
      debugInfo.push('');
      debugInfo.push(`Data keys: ${Object.keys(requestData || {}).join(', ')}`);
      
    } catch (parseError) {
      // If JSON parse fails, check if we have XML tags extracted
      if (extractedData.pageId || extractedData.taskId || extractedData.result) {
        const msg3 = `📋 JSON parse failed but found XML tags - treating as Zapier LLM result`;
        console.log(msg3);
        debugInfo.push(msg3);
        
        // Create structured data from extracted XML
        requestData = {
          isZapierLLMResult: true,
          taskId: extractedData.taskId,
          result: extractedData.result,
          pageId: extractedData.pageId,
          itemId: extractedData.itemId,
          contentType: extractedData.contentType,
          contentId: extractedData.contentId,
          rawFileName: extractedData.rawFileName,
          rawFileId: extractedData.rawFileId,
          prompt: extractedData.prompt,
          rawText: extractedData.rawText,
          rawContent: postData
        };
        
      } else {
        const msg4 = `❌ JSON PARSE ERROR and no XML tags found: ${parseError.toString()}`;
        console.log(msg4);
        debugInfo.push(msg4);
        
        // Save parse error to specific folder
        try {
          const logFolder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
          logFolder.createFile(`WEBAPP_DOPOST_PARSE_ERROR_${timestamp}.txt`, debugInfo.join('\n'));
        } catch (saveError) {
          console.log('Save parse error failed:', saveError.toString());
        }
        
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Invalid JSON data',
          error: parseError.toString(),
          timestamp: timestamp
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // FORCE SAVE all received data to specific folder
    try {
      const logFolder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
      logFolder.createFile(`WEBAPP_DOPOST_RECEIVED_${timestamp}.txt`, debugInfo.join('\n'));
      console.log('✅ Debug file saved successfully to log folder');
    } catch (saveError) {
      console.log('❌ Failed to save debug file:', saveError.toString());
    }
    
    // Determine routing based on data type
    let routingInfo = '';
    let result;
    
    if (requestData.isZapierLLMResult || (requestData.taskId && requestData.result)) {
      routingInfo = '🎯 ROUTING TO ZAPIER LLM RESULT HANDLER';
      console.log(routingInfo);
      console.log(`📋 Processing LLM result for Page ID: ${requestData.pageId}, Task ID: ${requestData.taskId}`);
      
      try {
        // Create request data structure for Zapier LLM result handler
        const requestDataForHandler = {
          taskId: requestData.taskId,
          result: requestData.result,
          pageId: requestData.pageId,
          itemId: requestData.itemId,
          contentType: requestData.contentType,
          contentId: requestData.contentId,
          rawFileName: requestData.rawFileName,
          rawFileId: requestData.rawFileId,
          metadata: {
            timestamp: timestamp,
            source: 'zapier_webhook'
          }
        };
        
        result = doPost_HandleZapierLLMResult(requestDataForHandler);
        console.log('✅ ZAPIER LLM RESULT HANDLER COMPLETED');
        
      } catch (zapierError) {
        console.log('❌ ZAPIER LLM RESULT HANDLER ERROR:', zapierError.toString());
        throw zapierError;
      }
      
    } else {
      routingInfo = '📋 ROUTING TO REGULAR HANDLER';
      console.log(routingInfo);
      
      try {
        // Try to parse the POST content as JSON for regular handling
        let requestData = {};
        try {
          if (e.postData?.contents) {
            // First try to parse as JSON
            requestData = JSON.parse(e.postData.contents);
          }
        } catch (jsonError) {
          // If not JSON, create a basic structure
          requestData = {
            rawContent: e.postData?.contents || '',
            extractedData: extractedData
          };
        }
        
        result = doPost_HandleRegularWebhook(requestData);
        console.log('✅ REGULAR HANDLER COMPLETED');
        
      } catch (regularError) {
        console.log('❌ REGULAR HANDLER ERROR:', regularError.toString());
        throw regularError;
      }
    }
    
    return result;
    
  } catch (error) {
    const errorMsg = `❌ CRITICAL ERROR: ${error.toString()}`;
    console.log(errorMsg);
    
    // FORCE save critical error to specific folder
    try {
      const errorContent = [
        `=== CRITICAL ERROR ${timestamp} ===`,
        `Error: ${error.toString()}`,
        `Stack: ${error.stack || 'No stack trace'}`,
        `Event: ${JSON.stringify(e, null, 2)}`
      ].join('\n');
      
      const logFolder = DriveApp.getFolderById('193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ');
      logFolder.createFile(`WEBAPP_DOPOST_CRITICAL_ERROR_${timestamp}.txt`, errorContent);
    } catch (saveError) {
      console.log('Critical: Could not save error file:', saveError.toString());
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', 
      message: 'Critical error in doPost',
      error: error.toString(),
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Call Zapier webhook with async handling
function callZapierWebhook(prompt, options = {}) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const webhookUrl = scriptProperties.getProperty(LLM_CONFIG.zapier_webhook.urlPropertyName) || 
                      LLM_CONFIG.zapier_webhook.defaultUrl;
    
    if (!webhookUrl) {
      throw new Error('Zapier webhook URL not configured');
    }
    
    debugLog('📤 Calling Zapier webhook', {
      url: webhookUrl.substring(0, 50) + '...',
      promptLength: prompt.length,
      rawContentLength: options.rawContent ? options.rawContent.length : 0,
      hasOptions: Object.keys(options).length > 0,
      hasRawContent: !!options.rawContent,
      hasMetadataRawContent: !!(options.metadata && options.metadata.rawContent)
    });
    
    // Generate unique task ID for tracking async responses
    const taskId = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Build metadata
    const metadata = options.metadata || {};
    metadata.active_llm = ACTIVE_LLM;
    metadata.wait_for_response = false;
    metadata.taskId = taskId;
    metadata.callbackUrl = getCallbackUrl();
    metadata.timestamp = new Date().toISOString();
    
    // Add pageId to metadata if available in options
    if (options.pageId) {
      metadata.pageId = options.pageId;
    }
    
    // Create payload following original structure
    const payload = {
      prompt: prompt,
      provider: options.provider || LLM_CONFIG.zapier_webhook.defaultProvider,
      model: options.model || LLM_CONFIG.zapier_webhook.defaultModel,
      authentication: options.authentication || LLM_CONFIG.zapier_webhook.defaultAuthentication,
      wait_for_response: false
    };
    
    // Add raw_text only if rawContent exists (following original logic)
    debugLog('🔍 Checking rawContent for raw_text', {
      hasRawContent: !!options.rawContent,
      rawContentType: typeof options.rawContent,
      rawContentLength: options.rawContent ? options.rawContent.length : 0,
      rawContentPreview: options.rawContent ? options.rawContent.substring(0, 100) + '...' : 'null'
    });
    
    if (typeof options.rawContent === 'string' && options.rawContent.trim().length > 0) {
      payload.raw_text = options.rawContent;
      debugLog('✅ Added raw_text to payload', { 
        rawTextLength: payload.raw_text.length 
      });
    } else {
      debugLog('❌ rawContent not valid for raw_text', {
        rawContent: options.rawContent,
        type: typeof options.rawContent
      });
    }
    
    // Add metadata if it has content
    if (Object.keys(metadata).length > 0) {
      payload.metadata = metadata;
    }
    
    // Add optional parameters
    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      payload.max_tokens = options.maxTokens;
    }
    
    debugLog('📋 Zapier payload prepared', {
      hasPrompt: !!payload.prompt,
      hasRawText: !!payload.raw_text,
      promptLength: payload.prompt ? payload.prompt.length : 0,
      rawTextLength: payload.raw_text ? payload.raw_text.length : 0,
      provider: payload.provider,
      model: payload.model,
      taskId: metadata.taskId
    });
    
    const requestOptions = {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(webhookUrl, requestOptions);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    debugLog('📨 Zapier webhook response received', {
      statusCode: responseCode,
      responseLength: responseText.length,
      taskId: taskId
    });
    
    if (responseCode !== 200) {
      throw new Error(`Zapier webhook failed with status ${responseCode}: ${responseText}`);
    }
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      debugLog('❌ Failed to parse Zapier response as JSON, treating as text', {
        responseText: responseText.substring(0, 200)
      });
      return responseText;
    }
    
    // Check if this is an async task (Zapier returns task ID instead of immediate result)
    if (data && (data.id || data.attempt || data.request_id) && data.status === 'success') {
      debugLog('🔄 Detected async Zapier task', {
        taskId: taskId,
        zapierTaskId: data.id || data.attempt || data.request_id,
        status: data.status
      });
      
      // Return a placeholder that indicates we need to wait for the result
      return `[ZAPIER_TASK_QUEUED:${taskId}]`;
    }
    
    // If we get a direct result, return it
    if (data && data.result) {
      debugLog('✅ Got immediate result from Zapier', {
        taskId: taskId,
        resultLength: data.result.length
      });
      return data.result;
    }
    
    // Fallback: return the raw response
    debugLog('📋 Using raw Zapier response', {
      taskId: taskId,
      responseType: typeof data
    });
    return responseText;
    
  } catch (error) {
    debugLog('❌ Error calling Zapier webhook', {
      error: error.toString(),
      stack: error.stack
    });
    throw error;
  }
}

// Get the callback URL for this Google Apps Script
function getCallbackUrl() {
  try {
    const scriptUrl = ScriptApp.getService().getUrl();
    return scriptUrl;
  } catch (error) {
    debugLog('❌ Error getting callback URL', { error: error.toString() });
    return 'https://script.google.com/macros/s/AKfycbx4ctw4jNRtyPCel7-tYH060w84_odTLaG7bvb2XLmCAGYLrC0ZXxZj19lrH318tgc/exec';
  }
}

// REMOVED DUPLICATE doPost FUNCTION - Using the one at the top of the file with logging

// Handle Zapier LLM results and resume async workflow
function doPost_HandleZapierLLMResult(requestData) {
  try {
    // Log the complete payload received from Zapier
    debugLog('📨 COMPLETE ZAPIER CALLBACK PAYLOAD', {
      fullPayload: requestData,
      payloadKeys: Object.keys(requestData || {}),
      payloadSize: JSON.stringify(requestData).length
    });
    
    const { taskId, result, metadata } = requestData;
    
    // NEW: Extract headers for content tracking
    const contentId = requestData.contentid || requestData.contentId || (metadata && metadata.contentId);
    const contentType = requestData.contenttype || requestData.contentType || (metadata && metadata.contentType);
    const rawFileId = requestData.rawfileid || requestData.rawFileId || (metadata && metadata.rawFileId);
    const rawFileName = requestData.rawfilename || requestData.rawFileName || (metadata && metadata.rawFileName);
    const itemId = requestData.itemid || requestData.itemId || (metadata && metadata.itemId);
    const pageId = requestData.pageid || requestData.pageId || (metadata && metadata.pageId);
    
    debugLog('📋 Extracted content tracking info', {
      contentId: contentId,
      contentType: contentType,
      rawFileId: rawFileId,
      rawFileName: rawFileName,
      itemId: itemId,
      pageId: pageId
    });
    
    debugLog('🔄 Processing Zapier LLM result', { 
      taskId: taskId,
      resultLength: result?.length || 0,
      hasMetadata: !!metadata,
      resultPreview: result ? result.substring(0, 200) + '...' : 'null',
      metadata: metadata
    });
    
    // Validate taskId
    if (!taskId) {
      throw new Error('No taskId provided in Zapier callback');
    }
    
    // Always save result to Drive immediately upon receiving from Zapier
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // NEW: Create processed result file based on content type
    let processedFileName, processedFileContent;
    
    if (contentType === 'main_page') {
      processedFileName = `processed_${contentId}_${timestamp}.md`;
      processedFileContent = `# Main Page LLM Result

**Content ID:** ${contentId}
**Item ID:** ${itemId}
**Page ID:** ${pageId}
**Content Type:** ${contentType}
**Task ID:** ${taskId}
**Raw File:** ${rawFileName}
**Raw File ID:** ${rawFileId}
**Processed:** ${new Date().toISOString()}

## LLM Processing Result

${result}

---
*Generated from raw file: ${rawFileName}*
*Task ID: ${taskId}*`;
      
    } else if (contentType === 'sub_block') {
      processedFileName = `processed_${contentId}_${timestamp}.md`;
      processedFileContent = `# Sub-Block LLM Result

**Content ID:** ${contentId}
**Item ID:** ${itemId}
**Page ID:** ${pageId}
**Content Type:** ${contentType}
**Task ID:** ${taskId}
**Raw File:** ${rawFileName}
**Raw File ID:** ${rawFileId}
**Processed:** ${new Date().toISOString()}

## LLM Processing Result

${result}

---
*Generated from raw file: ${rawFileName}*
*Task ID: ${taskId}*`;
      
    } else {
      // Fallback for unknown content types
      processedFileName = `processed_result_${taskId}_${timestamp}.txt`;
      processedFileContent = `LLM Processing Result
Task ID: ${taskId}
Content ID: ${contentId || 'unknown'}
Content Type: ${contentType || 'unknown'}
Processed: ${new Date().toISOString()}

${result}`;
    }
    
    // Also keep the original zapier result file for debugging
    const zapierFileName = `zapier_llm_result_${taskId}_${timestamp}.txt`;
    
    debugLog('💾 Saving processed LLM result to Drive', { 
      taskId: taskId,
      processedFileName: processedFileName,
      zapierFileName: zapierFileName,
      contentType: contentType,
      contentId: contentId,
      resultLength: result ? result.length : 0
    });
    
    try {
      const scriptProperties = PropertiesService.getScriptProperties();
      const folderId = scriptProperties.getProperty('DRIVE_FOLDER_ID');
      
      if (folderId) {
        const folder = DriveApp.getFolderById(folderId);
        
        // Save processed result file
        const processedFile = folder.createFile(processedFileName, processedFileContent, 'text/plain');
        
        // Save original zapier result for debugging
        const zapierFile = folder.createFile(zapierFileName, result, 'text/plain');
        
        debugLog('✅ Both processed and zapier files saved successfully', { 
          processedFileName: processedFileName,
          processedFileId: processedFile.getId(),
          zapierFileName: zapierFileName,
          zapierFileId: zapierFile.getId()
        });
      } else {
        // If no specific folder is configured, save to root Drive
        const processedFile = DriveApp.createFile(processedFileName, processedFileContent, 'text/plain');
        const zapierFile = DriveApp.createFile(zapierFileName, result, 'text/plain');
        
        debugLog('✅ Both files saved to root Drive', { 
          processedFileName: processedFileName,
          processedFileId: processedFile.getId(),
          zapierFileName: zapierFileName,
          zapierFileId: zapierFile.getId()
        });
      }
    } catch (saveError) {
      debugLog('❌ Error saving processed result files', { 
        processedFileName: processedFileName,
        zapierFileName: zapierFileName,
        error: saveError.toString()
      });
    }
    
    // NEW: Update page status control
    if (pageId && contentId && contentType) {
      debugLog('🎛️ Updating page status control', {
        pageId: pageId,
        itemId: itemId,
        contentType: contentType,
        taskId: taskId
      });
      
      const statusUpdate = updateItemStatusInControl(
        pageId, 
        itemId, 
        contentType, 
        taskId, 
        'completed', 
        processedFileName
      );
      
      if (statusUpdate && statusUpdate.readyForFinalProcessing) {
        debugLog('🎉 All items completed! Ready for final processing', {
          pageId: pageId,
          completedItems: statusUpdate.statusControl.tracking.completedItems,
          totalItems: statusUpdate.statusControl.tracking.totalItems
        });
        
        // Trigger final summary creation and webhook
        const finalResult = createFinalSummaryAndSendWebhook(pageId, statusUpdate.statusControl);
        
        if (finalResult && finalResult.success) {
          debugLog('✅ Final summary created and webhook sent', {
            pageId: pageId,
            finalSummaryFile: finalResult.finalSummaryFile,
            webhookSent: finalResult.webhookSent
          });
        }
      }
    }
    
    // Find which pageId this taskId belongs to by checking workflow states
    const pageIdFromWorkflow = findPageIdByTaskId(taskId);
    
    if (pageIdFromWorkflow) {
      debugLog('🔄 Resuming async workflow', { 
        pageId: pageIdFromWorkflow, 
        taskId: taskId,
        resultLength: result ? result.length : 0 
      });
      
      // Resume the workflow with the result
      try {
        debugLog('📞 Calling processNotionPage to resume workflow');
        const workflowResult = processNotionPage(pageIdFromWorkflow, true, result);
        
        debugLog('✅ Async workflow completed successfully', { 
          pageId: pageIdFromWorkflow,
          mode: workflowResult ? workflowResult.mode : 'unknown',
          workflowResult: workflowResult
        });
        
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          message: 'Workflow resumed and completed',
          taskId: taskId,
          pageId: pageIdFromWorkflow,
          workflowResult: workflowResult,
          // OLD: Keep for backward compatibility
          zapierResultFile: zapierFileName,
          // NEW: Add processed file information
          processedResultFile: processedFileName,
          contentType: contentType,
          contentId: contentId,
          itemId: itemId,
          rawFileName: rawFileName,
          timestamp: timestamp
        })).setMimeType(ContentService.MimeType.JSON);
        
      } catch (workflowError) {
        debugLog('❌ Error resuming workflow', { 
          pageId: pageIdFromWorkflow,
          taskId: taskId,
          error: workflowError.toString()
        });
        
        // Clear the workflow state on error
        clearWorkflowState(pageIdFromWorkflow);
        
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Error resuming workflow',
          error: workflowError.toString(),
          taskId: taskId,
          pageId: pageIdFromWorkflow,
          timestamp: timestamp
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
    } else {
      debugLog('⚠️ No pageId found for taskId, saving result for polling', { taskId: taskId });
      
      // Store result for legacy polling system
      const scriptProperties = PropertiesService.getScriptProperties();
      const resultKey = `ZAPIER_RESULT_${taskId}`;
      const resultData = {
        status: 'completed',
        result: result,
        fileName: zapierFileName,
        timestamp: timestamp,
        metadata: metadata || {},
        originalTaskId: taskId
      };
      
      scriptProperties.setProperty(resultKey, JSON.stringify(resultData));
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Result saved for polling',
        taskId: taskId,
        // OLD: Keep for backward compatibility
        zapierResultFile: zapierFileName,
        // NEW: Add processed file information
        processedResultFile: processedFileName,
        contentType: contentType,
        contentId: contentId,
        itemId: itemId,
        rawFileName: rawFileName,
        timestamp: timestamp
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
  } catch (error) {
    debugLog('❌ Error handling Zapier LLM result', { 
      error: error.toString(),
      taskId: requestData?.taskId
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Error processing result',
      error: error.toString(),
      taskId: requestData?.taskId,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Create final summary from all processed results and send webhook
function createFinalSummaryAndSendWebhook(pageId, statusControl) {
  debugLog('🎯 Creating final summary and sending webhook', { 
    pageId: pageId,
    totalItems: statusControl.tracking.totalItems,
    completedItems: statusControl.tracking.completedItems
  });
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Collect all processed results
    const results = {
      mainPage: null,
      subBlocks: []
    };
    
    // Load main page result
    if (statusControl.tracking.mainPage.processedFile) {
      try {
        const mainFile = DriveApp.getFilesByName(statusControl.tracking.mainPage.processedFile);
        if (mainFile.hasNext()) {
          const content = mainFile.next().getBlob().getDataAsString();
          // Extract just the LLM result part (after "## LLM Processing Result")
          const resultMatch = content.match(/## LLM Processing Result\s*\n\n([\s\S]*?)\n\n---/);
          results.mainPage = {
            content: resultMatch ? resultMatch[1].trim() : content,
            fileName: statusControl.tracking.mainPage.processedFile,
            itemId: statusControl.tracking.mainPage.itemId
          };
          debugLog('✅ Loaded main page result', { 
            fileName: statusControl.tracking.mainPage.processedFile,
            contentLength: results.mainPage.content.length
          });
        }
      } catch (error) {
        debugLog('❌ Error loading main page result', { 
          fileName: statusControl.tracking.mainPage.processedFile,
          error: error.toString()
        });
      }
    }
    
    // Load sub-block results
    Object.values(statusControl.tracking.subBlocks).forEach(subBlock => {
      if (subBlock.processedFile && subBlock.status === 'completed') {
        try {
          const subFile = DriveApp.getFilesByName(subBlock.processedFile);
          if (subFile.hasNext()) {
            const content = subFile.next().getBlob().getDataAsString();
            // Extract just the LLM result part
            const resultMatch = content.match(/## LLM Processing Result\s*\n\n([\s\S]*?)\n\n---/);
            results.subBlocks.push({
              content: resultMatch ? resultMatch[1].trim() : content,
              fileName: subBlock.processedFile,
              itemId: subBlock.itemId,
              sourceType: subBlock.sourceType,
              url: subBlock.url,
              title: subBlock.title
            });
            debugLog('✅ Loaded sub-block result', { 
              fileName: subBlock.processedFile,
              itemId: subBlock.itemId,
              contentLength: results.subBlocks[results.subBlocks.length - 1].content.length
            });
          }
        } catch (error) {
          debugLog('❌ Error loading sub-block result', { 
            fileName: subBlock.processedFile,
            itemId: subBlock.itemId,
            error: error.toString()
          });
        }
      }
    });
    
    // Create combined final summary
    const finalSummaryContent = createCombinedSummaryContent(pageId, statusControl, results);
    
    // Save final summary file
    const finalSummaryFileName = `final_summary_${pageId}_${timestamp}.md`;
    const finalSummaryFile = saveToGoogleDrive(finalSummaryContent, finalSummaryFileName);
    
    debugLog('✅ Final summary file created', { 
      fileName: finalSummaryFileName,
      fileId: finalSummaryFile.getId(),
      contentLength: finalSummaryContent.length
    });
    
    // Update status control
    statusControl.finalProcessing.allCompleted = true;
    statusControl.finalProcessing.finalSummaryCreated = true;
    statusControl.finalProcessing.finalSummaryFile = finalSummaryFileName;
    statusControl.finalProcessing.completedAt = new Date().toISOString();
    
    // Send to webhook
    let webhookSent = false;
    if (ENABLE_WEBHOOK && WEBHOOK_URL) {
      try {
        debugLog('📤 Sending final summary to webhook');
        
        const webhookPayload = {
          pageId: pageId,
          pageTitle: statusControl.pageTitle,
          summary: extractMainSummaryForWebhook(results),
          finalSummaryFile: finalSummaryFileName,
          processedAt: new Date().toISOString(),
          totalItems: statusControl.tracking.totalItems,
          totalSubBlocks: statusControl.tracking.totalSubBlocks,
          mode: 'final_complete',
          type: 'page_processing_complete'
        };
        
        const webhookResponse = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          payload: JSON.stringify(webhookPayload),
          muteHttpExceptions: true
        });
        
        const webhookStatus = webhookResponse.getResponseCode();
        
        if (webhookStatus >= 200 && webhookStatus < 300) {
          webhookSent = true;
          statusControl.finalProcessing.webhookSent = true;
          debugLog('✅ Final webhook sent successfully', { 
            pageId: pageId,
            statusCode: webhookStatus
          });
        } else {
          debugLog('⚠️ Final webhook returned non-success status', { 
            pageId: pageId,
            statusCode: webhookStatus,
            response: webhookResponse.getContentText()
          });
        }
        
      } catch (webhookError) {
        debugLog('❌ Error sending final webhook', { 
          pageId: pageId,
          error: webhookError.toString()
        });
      }
    }
    
    // Save updated status control
    savePageStatusControl(pageId, statusControl);
    
    return {
      success: true,
      finalSummaryFile: finalSummaryFileName,
      finalSummaryFileId: finalSummaryFile.getId(),
      webhookSent: webhookSent,
      totalItems: statusControl.tracking.totalItems,
      completedItems: statusControl.tracking.completedItems
    };
    
  } catch (error) {
    debugLog('❌ Error creating final summary and sending webhook', { 
      pageId: pageId,
      error: error.toString(),
      stack: error.stack
    });
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Create combined summary content from all results
function createCombinedSummaryContent(pageId, statusControl, results) {
  const timestamp = new Date().toISOString();
  
  let content = `# Final Combined Summary

**Page ID:** ${pageId}
**Page Title:** ${statusControl.pageTitle}
**Processing Completed:** ${timestamp}
**Total Items Processed:** ${statusControl.tracking.completedItems}/${statusControl.tracking.totalItems}
**Main Page + Sub-blocks:** ${1 + statusControl.tracking.totalSubBlocks}

---

`;

  // Add main page summary
  if (results.mainPage) {
    content += `## Main Page Summary

${results.mainPage.content}

---

`;
  }
  
  // Add sub-block summaries
  if (results.subBlocks.length > 0) {
    content += `## External Content Summaries

`;
    results.subBlocks.forEach((subBlock, index) => {
      content += `### External Content ${index + 1}: ${subBlock.title}

**Source Type:** ${subBlock.sourceType}
**Source URL:** ${subBlock.url}

${subBlock.content}

---

`;
    });
  }
  
  content += `## Processing Summary

- **Main Page:** ${results.mainPage ? 'Completed' : 'Not processed'}
- **Sub-blocks:** ${results.subBlocks.length} of ${statusControl.tracking.totalSubBlocks} processed
- **Total Processing Time:** From ${statusControl.initialized} to ${timestamp}

## Files Generated

- **Main Page Result:** ${statusControl.tracking.mainPage.processedFile || 'Not available'}
`;

  results.subBlocks.forEach((subBlock, index) => {
    content += `- **Sub-block ${index + 1} Result:** ${subBlock.fileName}\n`;
  });
  
  content += `
---

*Final summary generated by automated processing system*
*Page ID: ${pageId}*`;

  return content;
}

// Extract main summary for webhook (just the key content, not all the metadata)
function extractMainSummaryForWebhook(results) {
  if (results.mainPage) {
    return results.mainPage.content;
  } else if (results.subBlocks.length > 0) {
    return results.subBlocks[0].content;
  } else {
    return 'No content available for webhook summary';
  }
}

// Find pageId associated with a taskId
function findPageIdByTaskId(taskId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    
    // Look through all workflow states to find matching taskId
    for (const [key, value] of Object.entries(allProperties)) {
      if (key.startsWith('WORKFLOW_STATE_')) {
        try {
          const state = JSON.parse(value);
          if (state.taskId === taskId) {
            const pageId = key.replace('WORKFLOW_STATE_', '');
            debugLog('🔍 Found pageId for taskId', { pageId: pageId, taskId: taskId });
            return pageId;
          }
        } catch (parseError) {
          debugLog('⚠️ Error parsing workflow state', { key: key });
        }
      }
    }
    
    debugLog('❌ No pageId found for taskId', { taskId: taskId });
    return null;
    
  } catch (error) {
    debugLog('❌ Error finding pageId by taskId', { 
      taskId: taskId,
      error: error.toString()
    });
    return null;
  }
}

// Handle regular webhook (existing functionality)
function doPost_HandleRegularWebhook(requestData) {
  debugLog('📋 Processing regular webhook (not Zapier LLM result)');
  
  // Extract pageId from different possible formats
  let pageId = null;
  if (requestData.pageId) {
    pageId = requestData.pageId;
  } else if (requestData.data && requestData.data.id) {
    pageId = requestData.data.id;
  } else if (requestData.id) {
    pageId = requestData.id;
  }
  
  debugLog('📋 Extracted pageId from webhook', { 
    pageId: pageId,
    hasData: !!requestData.data,
    hasDirectPageId: !!requestData.pageId,
    hasDirectId: !!requestData.id
  });
  
  if (pageId) {
    try {
      debugLog('🚀 Starting Notion page processing', { pageId: pageId });
      processNotionPage(pageId);
      const response = {
        status: 'success',
        message: 'Processing started',
        pageId: pageId,
        timestamp: new Date().toISOString()
      };
      return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
      debugLog('❌ Error processing Notion page', { 
        pageId: pageId,
        error: error.toString() 
      });
      const errorResponse = {
        status: 'error',
        message: error.toString(),
        pageId: pageId,
        timestamp: new Date().toISOString()
      };
      return ContentService.createTextOutput(JSON.stringify(errorResponse)).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  debugLog('⚠️ No pageId found in webhook request', { requestData: requestData });
  const response = {
    status: 'success',
    message: 'Webhook received but no pageId found',
    timestamp: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// Wait for Zapier result with infinite wait option
function waitForZapierResult(taskId, pageId, progressFileName, maxWaitSeconds = 0) {
  debugLog('⏳ Starting to wait for Zapier result', {
    taskId: taskId,
    pageId: pageId,
    maxWaitSeconds: maxWaitSeconds,
    waitForever: maxWaitSeconds === 0
  });
  
  const startTime = new Date().getTime();
  const waitForever = maxWaitSeconds === 0;
  let lastStatusUpdate = startTime;
  const statusUpdateInterval = 30 * 1000; // Update every 30 seconds
  
  let waitCycles = 0;
  
  while (true) {
    waitCycles++;
    
    // Check for result
    const result = checkForZapierResult(taskId);
    if (result) {
      debugLog('✅ Zapier result found!', {
        taskId: taskId,
        waitCycles: waitCycles,
        totalWaitTime: `${Math.round((new Date().getTime() - startTime) / 1000)}s`
      });
      return result;
    }
    
    // Check timeout (only if not waiting forever)
    const elapsed = new Date().getTime() - startTime;
    if (!waitForever && elapsed > (maxWaitSeconds * 1000)) {
      debugLog('⏰ Timeout waiting for Zapier result', {
        taskId: taskId,
        elapsedSeconds: Math.round(elapsed / 1000),
        maxWaitSeconds: maxWaitSeconds
      });
      return null;
    }
    
    // Status update every 30 seconds
    if (elapsed - (lastStatusUpdate - startTime) > statusUpdateInterval) {
      lastStatusUpdate = new Date().getTime();
      const elapsedSeconds = Math.round(elapsed / 1000);
      
      debugLog('⏳ Still waiting for Zapier result...', {
        taskId: taskId,
        elapsedSeconds: elapsedSeconds,
        waitCycles: waitCycles,
        waitingForever: waitForever
      });
      
      // Update progress file if provided
      if (progressFileName && pageId) {
        updateProgressFile(progressFileName, pageId, `Waiting for Zapier (${elapsedSeconds}s, cycle ${waitCycles})`);
      }
    }
    
    // Wait 5 seconds before next check
    Utilities.sleep(5000);
  }
}

// Check if Zapier result is available
function checkForZapierResult(taskId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const resultKey = `ZAPIER_RESULT_${taskId}`;
    
    debugLog('🔍 Checking for Zapier result', {
      taskId: taskId,
      resultKey: resultKey
    });
    
    const resultData = scriptProperties.getProperty(resultKey);
    
    if (resultData) {
      const parsed = JSON.parse(resultData);
      debugLog('📋 Found Zapier result in Properties', {
        taskId: taskId,
        status: parsed.status,
        hasResult: !!parsed.result,
        fileName: parsed.fileName,
        resultLength: parsed.result?.length || 0,
        originalTaskId: parsed.originalTaskId
      });
      
      // Validate that the taskId matches
      if (parsed.originalTaskId && parsed.originalTaskId !== taskId) {
        debugLog('⚠️ TaskId mismatch in stored result', {
          requestedTaskId: taskId,
          storedTaskId: parsed.originalTaskId
        });
      }
      
      // Clean up the property after retrieval
      scriptProperties.deleteProperty(resultKey);
      
      return parsed.result;
    }
    
    // Also check if there are any properties with similar keys (debugging)
    const allProperties = scriptProperties.getProperties();
    const zapierKeys = Object.keys(allProperties).filter(key => key.startsWith('ZAPIER_RESULT_'));
    
    if (zapierKeys.length > 0) {
      debugLog('🔍 Found other Zapier result keys', {
        searchingFor: resultKey,
        foundKeys: zapierKeys,
        totalZapierResults: zapierKeys.length
      });
    }
    
    return null;
    
  } catch (error) {
    debugLog('❌ Error checking for Zapier result', {
      taskId: taskId,
      error: error.toString()
    });
    return null;
  }
}

// Extract Zapier metadata value from payload
function extractZapierMetadataValue(payload, field) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directValue = payload[field];
  if (typeof directValue === 'string' && directValue.trim().length > 0) {
    return directValue.trim();
  }

  const metadata = payload.metadata;
  if (metadata && typeof metadata === 'object') {
    const value = metadata[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  const data = payload.data;
  if (data && typeof data === 'object') {
    const value = data[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

// Extract summary from Zapier payload
function extractSummaryFromZapierPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { summary: null, source: null };
  }

  const candidateFields = ['summary', 'result', 'output', 'text', 'body', 'content'];

  const checkObject = (source, label) => {
    if (!source) {
      return { summary: null, source: null };
    }

    if (typeof source === 'string' && source.trim().length > 0) {
      return { summary: source.trim(), source: label || 'string' };
    }

    if (typeof source === 'object') {
      for (let i = 0; i < candidateFields.length; i++) {
        const field = candidateFields[i];
        const value = source[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          return { summary: value.trim(), source: label ? `${label}.${field}` : field };
        }
      }

      if (Array.isArray(source.choices) && source.choices.length > 0) {
        const firstChoice = source.choices[0];
        if (firstChoice && firstChoice.message && typeof firstChoice.message.content === 'string' && firstChoice.message.content.trim().length > 0) {
          return { summary: firstChoice.message.content.trim(), source: label ? `${label}.choices[0].message.content` : 'choices[0].message.content' };
        }
        if (firstChoice && typeof firstChoice.text === 'string' && firstChoice.text.trim().length > 0) {
          return { summary: firstChoice.text.trim(), source: label ? `${label}.choices[0].text` : 'choices[0].text' };
        }
      }
    }

    return { summary: null, source: null };
  };

  const direct = checkObject(payload, 'payload');
  if (direct.summary) {
    return direct;
  }

  const fromData = checkObject(payload.data, 'payload.data');
  if (fromData.summary) {
    return fromData;
  }

  const fromMetadata = checkObject(payload.metadata, 'payload.metadata');
  if (fromMetadata.summary) {
    return fromMetadata;
  }

  return { summary: null, source: null };
}

// Handle Zapier LLM result callback - THE MISSING FUNCTION!
function doPost_HandleZapierLLMResult(requestData) {
  debugLog('🎯 Processing Zapier LLM result callback', { 
    taskId: requestData.taskId,
    pageId: requestData.pageId,
    contentType: requestData.contentType,
    itemId: requestData.itemId,
    hasResult: !!requestData.result,
    resultLength: requestData.result ? requestData.result.length : 0,
    requestDataKeys: Object.keys(requestData || {})
  });
  
  try {
    const { taskId, result, pageId, itemId, contentType, contentId, rawFileName, rawFileId } = requestData;
    
    // Debug the extracted values
    debugLog('📋 Extracted values from requestData', {
      taskId: taskId,
      hasResult: !!result,
      resultLength: result ? result.length : 0,
      pageId: pageId,
      itemId: itemId,
      contentType: contentType,
      contentId: contentId,
      rawFileName: rawFileName,
      rawFileId: rawFileId
    });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Create processed result file
    const processedFileName = `processed_${contentId}_${timestamp}.md`;
    const processedFileContent = `# ${contentType === 'main_page' ? 'Main Page' : 'Sub-Block'} LLM Result

**Content ID:** ${contentId}
**Item ID:** ${itemId}
**Page ID:** ${pageId}
**Content Type:** ${contentType}
**Task ID:** ${taskId}
**Raw File:** ${rawFileName}
**Raw File ID:** ${rawFileId}
**Processed:** ${new Date().toISOString()}

## LLM Processing Result

${result}

---
*Generated by automated LLM processing*`;

    // Save processed file
    const processedFile = saveToGoogleDrive(processedFileContent, processedFileName);
    
    debugLog('✅ Processed file saved', { 
      fileName: processedFileName,
      fileId: processedFile.getId()
    });
    
    // Update item status in control and check completion
    const updateResult = updateItemStatusInControl(pageId, itemId, contentType, taskId, 'completed', processedFileName);
    
    if (updateResult && updateResult.allCompleted && updateResult.readyForFinalProcessing) {
      debugLog('🎉 All items completed! Triggering final processing', { pageId: pageId });
      
      // Trigger final summary and webhook
      const finalResult = createFinalSummaryAndSendWebhook(pageId, updateResult.statusControl);
      
      debugLog('✅ Final processing completed', { 
        pageId: pageId,
        success: finalResult.success,
        webhookSent: finalResult.webhookSent
      });
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'completed_all',
        message: 'All items completed and final webhook sent',
        pageId: pageId,
        taskId: taskId,
        processedFile: processedFileName,
        finalSummaryFile: finalResult.finalSummaryFile,
        webhookSent: finalResult.webhookSent,
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
      
    } else {
      debugLog('✅ Item completed, waiting for others', { 
        pageId: pageId,
        completedItems: updateResult?.statusControl?.tracking?.completedItems || 0,
        totalItems: updateResult?.statusControl?.tracking?.totalItems || 0
      });
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'completed_item',
        message: 'Item processed successfully, waiting for others',
        pageId: pageId,
        taskId: taskId,
        processedFile: processedFileName,
        completedItems: updateResult?.statusControl?.tracking?.completedItems || 0,
        totalItems: updateResult?.statusControl?.tracking?.totalItems || 0,
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
  } catch (error) {
    debugLog('❌ Error handling Zapier LLM result', { 
      error: error.toString(),
      taskId: requestData?.taskId,
      pageId: requestData?.pageId
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Error processing LLM result',
      error: error.toString(),
      taskId: requestData?.taskId,
      pageId: requestData?.pageId,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Extract XML tags from POST content (for Zapier metadata)
function extractXMLTagsFromContent(content) {
  if (!content || typeof content !== 'string') {
    return {};
  }
  
  const extractedData = {};
  
  // Helper function to extract tag value (robust version)
  function extractTag(text, tagName) {
    // Try exact case match first
    let pattern = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'is');
    let match = text.match(pattern);
    if (match) return match[1].trim();
    
    // Try case insensitive with different closing tags
    pattern = new RegExp(`<${tagName}>(.*?)</${tagName.toLowerCase()}>`, 'is');
    match = text.match(pattern);
    if (match) return match[1].trim();
    
    // Try with different case combinations
    pattern = new RegExp(`<${tagName.toLowerCase()}>(.*?)</${tagName.toLowerCase()}>`, 'is');
    match = text.match(pattern);
    if (match) return match[1].trim();
    
    // Special handling for result tag that might be at the end without closing
    if (tagName.toLowerCase() === 'result') {
      pattern = new RegExp(`<${tagName}>(.*)$`, 'is');
      match = text.match(pattern);
      if (match) {
        // Clean up any remaining XML at the end
        let result = match[1].trim();
        // Remove any trailing XML that might be malformed
        result = result.replace(/<\/[^>]*>*$/g, '').trim();
        return result;
      }
    }
    
    return null;
  }
  
  // Extract all known tags (including alternate spellings)
  extractedData.pageId = extractTag(content, 'pageId') || extractTag(content, 'pageid');
  extractedData.taskId = extractTag(content, 'taskId');
  extractedData.result = extractTag(content, 'result');
  extractedData.prompt = extractTag(content, 'prompt');
  extractedData.rawText = extractTag(content, 'raw_text');
  extractedData.itemId = extractTag(content, 'itemId') || extractTag(content, 'temId') || extractTag(content, 'ItemId'); // Handle case variations
  extractedData.contentType = extractTag(content, 'contentType');
  extractedData.contentId = extractTag(content, 'contentId');
  extractedData.rawFileName = extractTag(content, 'rawFileName');
  extractedData.rawFileId = extractTag(content, 'rawFileId');
  
  // Post-process result to unescape newlines if needed
  if (extractedData.result) {
    // Convert \n to actual newlines if the content is escaped
    extractedData.result = extractedData.result.replace(/\\n/g, '\n');
    
    debugLog('🔍 Result extraction successful', {
      resultLength: extractedData.result.length,
      firstLine: extractedData.result.split('\n')[0],
      hasNewlines: extractedData.result.includes('\n')
    });
  }
  
  return extractedData;
}

// Store Zapier callback log
function storeZapierCallbackLog(entry) {
  try {
    const safeEntry = entry || {};
    let serialized = JSON.stringify(safeEntry);

    if (serialized.length > 9000) {
      serialized = JSON.stringify({
        warning: 'Truncated callback log',
        preview: serialized.substring(0, 8800)
      });
    }

    PropertiesService.getScriptProperties().setProperty('LAST_ZAPIER_CALLBACK', serialized);
  } catch (error) {
    debugLog('Failed to store Zapier callback log:', error.toString());
  }
}