// ==================== MAIN PROCESSING FUNCTIONS ====================
// Core functions for processing Notion pages and handling LLM calls

// Unified LLM interface with rate limiting and retry logic
function callLLM(prompt, options = {}) {
  // Validate prompt input
  if (!prompt || typeof prompt !== 'string') {
    debugLog('Invalid prompt provided to callLLM:', { type: typeof prompt, value: prompt });
    return null;
  }
  
  const llm = ACTIVE_LLM.toLowerCase();
  debugLog(`Calling ${llm.toUpperCase()} LLM with prompt length: ${prompt.length}`);
  
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      // Add delay to respect rate limits
      if (retries > 0) {
        const delay = LLM_RATE_LIMIT_DELAY * (retries + 1);
        debugLog(`Retry ${retries}, waiting ${delay}ms`);
        sleep(delay);
      }
      
      let result;
      switch (llm) {
        case 'claude':
          result = callClaude(prompt, options);
          break;
        case 'openai':
          result = callOpenAI(prompt, options);
          break;
        case 'gemini':
          result = callGemini(prompt, options);
          break;
        case 'zapier_webhook':
          result = callZapierWebhook(prompt, options);
          
          // In async mode, extract and return just the taskId without waiting
          if (options.metadata && options.metadata.mode === 'async_workflow') {
            if (result && result.startsWith('[ZAPIER_TASK_QUEUED:')) {
              const taskIdMatch = result.match(/\[ZAPIER_TASK_QUEUED:([^\]]+)\]/);
              if (taskIdMatch) {
                const taskId = taskIdMatch[1];
                debugLog('🚀 Async mode: extracted taskId, returning immediately', { taskId: taskId });
                return taskId; // Return just the taskId for async workflow
              }
            }
            debugLog('🚀 Async mode: returning result as-is', { result: result });
            return result;
          }
          
          // Legacy mode: Handle async Zapier responses with polling
          if (result && result.startsWith('[ZAPIER_TASK_QUEUED:')) {
            const taskIdMatch = result.match(/\[ZAPIER_TASK_QUEUED:([^\]]+)\]/);
            if (taskIdMatch) {
              const taskId = taskIdMatch[1];
              debugLog('🔄 Legacy mode: Zapier task queued, waiting for result', { taskId: taskId });
              
              // Wait for the result (infinite wait)
              result = waitForZapierResult(taskId, options.pageId, options.progressFileName, 0);
              
              if (!result) {
                throw new Error('Failed to get result from Zapier webhook');
              }
              
              debugLog('✅ Received Zapier result after waiting', { 
                taskId: taskId,
                resultLength: result.length 
              });
            }
          }
          break;
        default:
          throw new Error(`Unsupported LLM: ${llm}`);
      }
      
      if (result) {
        return result;
      } else {
        throw new Error('Empty response from LLM');
      }
      
    } catch (error) {
      debugLog(`LLM call attempt ${retries + 1} failed:`, error);
      retries++;
      
      // Check for rate limit errors specifically
      if (error.toString().includes('rate_limit') || error.toString().includes('429') || error.toString().includes('acceleration limit')) {
        debugLog('Rate limit detected, using progressive delay');
        const progressiveDelay = LLM_RATE_LIMIT_DELAY * Math.pow(2, retries); // Exponential backoff
        sleep(progressiveDelay);
      }
      
      if (retries >= MAX_RETRIES) {
        debugLog(`Max retries (${MAX_RETRIES}) exceeded for LLM call`);
        return null;
      }
    }
  }
  
  return null;
}

// Process large content in chunks with rate limiting
function processLargeContent(content, promptTemplate) {
  if (typeof content !== 'string') {
    debugLog('processLargeContent received invalid content:', {
      type: typeof content,
      hasValue: !!content
    });
    return null;
  }

  if (!promptTemplate || typeof promptTemplate !== 'string') {
    debugLog('processLargeContent received invalid prompt template:', {
      type: typeof promptTemplate,
      hasValue: !!promptTemplate
    });
    return callLLM(content, {
      rawContent: content,
      metadata: { context: 'main_document_fallback', mode: 'no_template' }
    });
  }

  if (content.length <= CHUNK_SIZE) {
    debugLog('Content small enough for single LLM call');
    const prompt = promptTemplate.replace('${content}', content);
    return callLLM(prompt, {
      rawContent: content,
      metadata: { context: 'main_document', mode: 'single_pass' }
    });
  }

  debugLog(`Content too large (${content.length} chars), processing in chunks`);
  const chunks = chunkContent(content);

  if (!Array.isArray(chunks) || chunks.length === 0) {
    debugLog('chunkContent returned no chunks, skipping large content processing');
    return null;
  }

  debugLog(`Split into ${chunks.length} chunks`);

  const summaries = [];

  for (let i = 0; i < chunks.length; i++) {
    debugLog(`Processing chunk ${i + 1}/${chunks.length}`);

    if (i > 0) {
      debugLog(`Waiting ${LLM_RATE_LIMIT_DELAY}ms between chunks`);
      sleep(LLM_RATE_LIMIT_DELAY);
    }

    const chunkPrompt = createChunkPrompt(chunks[i], i + 1, chunks.length);
    const chunkSummary = callLLM(chunkPrompt, {
      rawContent: chunks[i],
      metadata: { 
        context: 'main_document', 
        mode: 'chunk', 
        chunkNumber: i + 1, 
        totalChunks: chunks.length,
        rawContent: chunks[i]
      }
    });

    if (chunkSummary) {
      summaries.push(chunkSummary);
      debugLog(`Chunk ${i + 1} processed successfully`);
    } else {
      debugLog(`Chunk ${i + 1} failed to process`);
      summaries.push(`[Chunk ${i + 1} failed to process]`);
    }
  }

  if (summaries.length > 1) {
    debugLog('Combining chunk summaries');
    const combinedContent = summaries.join('\n---\n\n');

    sleep(LLM_RATE_LIMIT_DELAY);

    const finalPrompt = createCombinePrompt(combinedContent);
    const finalSummary = callLLM(finalPrompt, {
      rawContent: combinedContent,
      metadata: { context: 'main_document', mode: 'chunk_combine' }
    });

    return finalSummary || combinedContent;
  }

  return summaries.length === 1 ? summaries[0] : null;
}

// Document structure to track all components with indexing system
class DocumentStructure {
  constructor(pageId, pageTitle) {
    this.pageId = pageId;
    this.pageTitle = pageTitle;
    this.mainContent = null; // Original content with all blocks/errors
    this.cleanedContent = null; // Cleaned content for LLM processing
    this.mainSummary = null;
    this.externalLinks = [];
    this.subItems = []; // External content summaries
    this.isMeetingTranscription = false;
    this.timestamp = new Date().toISOString();
    this.unsupportedBlocks = []; // Track unsupported blocks
    this.contentIssuesCount = 0; // Count of issues found
    this.issuesLogFile = null; // Reference to issues log file
    
    // NEW: Indexing system
    this.index = {
      main: {
        id: `${pageId}_main`,
        type: 'main_page',
        contentId: `${pageId}_main`,
        title: pageTitle,
        rawFileId: null, // Will store raw file reference
        processedFileId: null, // Will store processed file reference
        status: 'pending'
      },
      subBlocks: [], // Array of external content blocks
      totalItems: 1 // Start with 1 for main page
    };
  }
  
  addExternalLink(type, url, content, summary = null) {
    this.externalLinks.push({
      type: type,
      url: url,
      content: content,
      summary: summary,
      timestamp: new Date().toISOString()
    });
  }
  
  // NEW: Add external sub-block to index
  addSubBlock(url, type, title = null, content = null) {
    const subBlockId = `${this.pageId}_sub_${this.index.totalItems}`;
    const contentId = `${this.pageId}_sub_${this.index.totalItems}`;
    
    const subBlock = {
      id: subBlockId,
      type: 'sub_block',
      contentId: contentId,
      sourceType: type, // google_doc, google_sheet, notion_page, etc.
      url: url,
      title: title || `External Content ${this.index.totalItems}`,
      content: content,
      rawFileId: null, // Will store raw file reference
      processedFileId: null, // Will store processed file reference
      status: 'pending',
      timestamp: new Date().toISOString()
    };
    
    this.index.subBlocks.push(subBlock);
    this.index.totalItems++;
    
    debugLog('📋 Added sub-block to index', {
      subBlockId: subBlockId,
      sourceType: type,
      url: url,
      totalItems: this.index.totalItems
    });
    
    return subBlock;
  }
  
  // Get sub-block by ID
  getSubBlock(subBlockId) {
    return this.index.subBlocks.find(block => block.id === subBlockId);
  }
  
  // Get all pending items (main + sub-blocks) for processing
  getPendingItems() {
    const pending = [];
    
    if (this.index.main.status === 'pending') {
      pending.push(this.index.main);
    }
    
    this.index.subBlocks.forEach(block => {
      if (block.status === 'pending') {
        pending.push(block);
      }
    });
    
    return pending;
  }
  
  // Update item status
  updateItemStatus(itemId, status) {
    if (this.index.main.id === itemId) {
      this.index.main.status = status;
      debugLog('📝 Updated main page status', { itemId: itemId, status: status });
    } else {
      const subBlock = this.getSubBlock(itemId);
      if (subBlock) {
        subBlock.status = status;
        debugLog('📝 Updated sub-block status', { itemId: itemId, status: status });
      }
    }
  }
  
  // Create index summary for logging
  getIndexSummary() {
    return {
      pageId: this.pageId,
      mainPage: this.index.main,
      subBlocks: this.index.subBlocks.map(block => ({
        id: block.id,
        type: block.sourceType,
        url: block.url,
        title: block.title,
        status: block.status
      })),
      totalItems: this.index.totalItems,
      pendingItems: this.getPendingItems().length
    };
  }
  
  addUnsupportedBlock(blockType, blockId) {
    this.unsupportedBlocks.push({
      type: blockType,
      id: blockId,
      timestamp: new Date().toISOString()
    });
  }
  
  detectMeetingTranscription() {
    const meetingKeywords = [
      'meeting', 'transcript', 'minutes', 'attendees', 'action items',
      'discussed', 'agenda', 'participants', 'recording'    ];
    
    // Use cleaned content for detection
    const contentToAnalyze = this.cleanedContent || this.mainContent || '';
    const contentLower = contentToAnalyze.toLowerCase();
    const keywordCount = meetingKeywords.filter(keyword => 
      contentLower.includes(keyword)
    ).length;
    
    this.isMeetingTranscription = keywordCount >= 3;
    debugLog('Meeting transcription detection:', {
      keywordCount: keywordCount,
      isMeeting: this.isMeetingTranscription,
      analyzedContent: 'cleaned'
    });
  }
}

// Extract external links from content and create sub-blocks
function extractExternalLinksAndCreateIndex(doc) {
  debugLog('🔍 Extracting external links from content', { 
    pageId: doc.pageId,
    contentLength: doc.mainContent ? doc.mainContent.length : 0 
  });
  
  if (!doc.mainContent) {
    debugLog('⚠️ No main content to extract links from');
    return;
  }
  
  // Common URL patterns for external content
  const urlPatterns = [
    // Google Docs
    {
      pattern: /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/g,
      type: 'google_doc'
    },
    // Google Sheets
    {
      pattern: /https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/g,
      type: 'google_sheet'
    },
    // Google Slides
    {
      pattern: /https:\/\/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9-_]+)/g,
      type: 'google_slides'
    },
    // Google Drive Files
    {
      pattern: /https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/g,
      type: 'google_drive_file'
    },
    // Notion Pages
    {
      pattern: /https:\/\/[^\/]*notion\.so\/[^\/]*\/([a-zA-Z0-9-]+)/g,
      type: 'notion_page'
    },
    // Loom Videos
    {
      pattern: /https:\/\/www\.loom\.com\/share\/([a-zA-Z0-9]+)/g,
      type: 'loom_video'
    }
  ];
  
  let foundLinks = 0;
  
  urlPatterns.forEach(({ pattern, type }) => {
    let match;
    while ((match = pattern.exec(doc.mainContent)) !== null) {
      const url = match[0];
      const id = match[1];
      
      // Check if this URL was already added
      const existingSubBlock = doc.index.subBlocks.find(block => block.url === url);
      if (!existingSubBlock) {
        // Extract title from surrounding context if possible
        const title = extractTitleFromContext(doc.mainContent, match.index, url, type);
        
        // Add to index
        const subBlock = doc.addSubBlock(url, type, title);
        foundLinks++;
        
        debugLog('🔗 Found external link', {
          url: url,
          type: type,
          id: id,
          title: title,
          subBlockId: subBlock.id
        });
      }
    }
  });
  
  debugLog('📊 External link extraction completed', {
    pageId: doc.pageId,
    foundLinks: foundLinks,
    totalSubBlocks: doc.index.subBlocks.length,
    totalItems: doc.index.totalItems
  });
  
  return foundLinks;
}

// Extract title from surrounding context
function extractTitleFromContext(content, linkIndex, url, type) {
  const contextStart = Math.max(0, linkIndex - 100);
  const contextEnd = Math.min(content.length, linkIndex + url.length + 100);
  const context = content.substring(contextStart, contextEnd);
  
  // Try to find title patterns
  const titlePatterns = [
    // Markdown-style links [title](url)
    /\[([^\]]+)\]\([^)]*\)/,
    // Text before the link
    /([^\n\r\.]{1,50})\s*https?:\/\//,
    // Text after "title:" or "name:"
    /(title|name):\s*([^\n\r\.]{1,50})/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = context.match(pattern);
    if (match && match[1] && match[1].trim().length > 3) {
      return match[1].trim();
    }
  }
  
  // Fallback to type-based default
  const typeDefaults = {
    'google_doc': 'Google Document',
    'google_sheet': 'Google Spreadsheet', 
    'google_slides': 'Google Presentation',
    'google_drive_file': 'Google Drive File',
    'notion_page': 'Notion Page',
    'loom_video': 'Loom Video'
  };
  
  return typeDefaults[type] || 'External Content';
}

// Create raw files for main page and sub-blocks
function createRawFiles(doc) {
  debugLog('📁 Creating raw files for indexing', { 
    pageId: doc.pageId,
    totalItems: doc.index.totalItems 
  });
  
  const timestamp = doc.timestamp.replace(/[:.]/g, '-');
  const createdFiles = {
    main: null,
    subBlocks: [],
    index: null
  };
  
  // Create raw file for main page
  if (doc.cleanedContent) {
    const mainRawFileName = `raw_${doc.pageId}_main_${timestamp}.txt`;
    const mainRawContent = `# MAIN PAGE RAW CONTENT
Page ID: ${doc.pageId}
Page Title: ${doc.pageTitle}
Content Type: main_page
Content ID: ${doc.index.main.contentId}
Timestamp: ${doc.timestamp}
Content Length: ${doc.cleanedContent.length} characters

====== CONTENT ======

${doc.cleanedContent}`;
    
    try {
      const mainFile = saveToGoogleDrive(mainRawContent, mainRawFileName);
      doc.index.main.rawFileId = mainFile.getId();
      doc.index.main.rawFileName = mainRawFileName; // NEW: Store file name
      
      createdFiles.main = {
        fileName: mainRawFileName,
        fileId: mainFile.getId(),
        contentId: doc.index.main.contentId,
        itemId: doc.index.main.id
      };
      
      debugLog('✅ Created main page raw file', { 
        fileName: mainRawFileName,
        fileId: mainFile.getId(),
        contentId: doc.index.main.contentId
      });
    } catch (error) {
      debugLog('❌ Error creating main page raw file', { 
        fileName: mainRawFileName,
        error: error.toString() 
      });
    }
  }
  
  // Create raw files for sub-blocks (for now, just placeholder content)
  doc.index.subBlocks.forEach(subBlock => {
    const subRawFileName = `raw_${subBlock.contentId}_${timestamp}.txt`;
    const subRawContent = `# SUB-BLOCK RAW CONTENT
Page ID: ${doc.pageId}
Sub-Block ID: ${subBlock.id}
Content ID: ${subBlock.contentId}
Source Type: ${subBlock.sourceType}
Source URL: ${subBlock.url}
Title: ${subBlock.title}
Content Type: sub_block
Timestamp: ${subBlock.timestamp}

====== CONTENT ======

${subBlock.content || '[Content will be extracted from external source]'}

====== METADATA ======
Parent Page: ${doc.pageTitle}
External URL: ${subBlock.url}
Source Type: ${subBlock.sourceType}`;
    
    try {
      const subFile = saveToGoogleDrive(subRawContent, subRawFileName);
      subBlock.rawFileId = subFile.getId();
      subBlock.rawFileName = subRawFileName; // NEW: Store file name
      
      const subFileInfo = {
        fileName: subRawFileName,
        fileId: subFile.getId(),
        contentId: subBlock.contentId,
        itemId: subBlock.id,
        sourceType: subBlock.sourceType,
        url: subBlock.url
      };
      
      createdFiles.subBlocks.push(subFileInfo);
      
      debugLog('✅ Created sub-block raw file', { 
        fileName: subRawFileName,
        fileId: subFile.getId(),
        contentId: subBlock.contentId,
        sourceType: subBlock.sourceType
      });
    } catch (error) {
      debugLog('❌ Error creating sub-block raw file', { 
        fileName: subRawFileName,
        contentId: subBlock.contentId,
        error: error.toString() 
      });
    }
  });
  
  // Create index file
  const indexFileName = `index_${doc.pageId}_${timestamp}.json`;
  const indexContent = JSON.stringify({
    pageId: doc.pageId,
    pageTitle: doc.pageTitle,
    timestamp: doc.timestamp,
    index: doc.index,
    summary: doc.getIndexSummary()
  }, null, 2);
  
  try {
    const indexFile = saveToGoogleDrive(indexContent, indexFileName);
    
    createdFiles.index = {
      fileName: indexFileName,
      fileId: indexFile.getId()
    };
    
    debugLog('✅ Created index file', { 
      fileName: indexFileName,
      fileId: indexFile.getId(),
      totalItems: doc.index.totalItems
    });
  } catch (error) {
    debugLog('❌ Error creating index file', { 
      fileName: indexFileName,
      error: error.toString() 
    });
  }
  
  debugLog('📁 Raw file creation completed', {
    pageId: doc.pageId,
    mainFileCreated: !!doc.index.main.rawFileId,
    subBlockFilesCreated: doc.index.subBlocks.filter(block => block.rawFileId).length,
    totalSubBlocks: doc.index.subBlocks.length,
    createdFiles: createdFiles
  });
  
  return createdFiles;
}

// Async workflow state management
function saveWorkflowState(pageId, state) {
  const stateKey = `WORKFLOW_STATE_${pageId}`;
  const stateData = {
    ...state,
    timestamp: new Date().toISOString(),
    pageId: pageId
  };
  
  PropertiesService.getScriptProperties().setProperty(stateKey, JSON.stringify(stateData));
  debugLog('💾 Workflow state saved', { pageId: pageId, step: state.step });
}

function loadWorkflowState(pageId) {
  const stateKey = `WORKFLOW_STATE_${pageId}`;
  const stateData = PropertiesService.getScriptProperties().getProperty(stateKey);
  
  if (stateData) {
    const state = JSON.parse(stateData);
    debugLog('📋 Workflow state loaded', { pageId: pageId, step: state.step });
    return state;
  }
  
  return null;
}

function clearWorkflowState(pageId) {
  const stateKey = `WORKFLOW_STATE_${pageId}`;
  PropertiesService.getScriptProperties().deleteProperty(stateKey);
  debugLog('🗑️ Workflow state cleared', { pageId: pageId });
}

// Main function to process a Notion page (async version)
function processNotionPage(pageId, resumeFromCallback = false, callbackResult = null) {
  debugLog('🚀 Starting Notion page processing', { 
    pageId: pageId, 
    resumeFromCallback: resumeFromCallback 
  });
  
  try {
    let state, timestamp, progressFileName;
    
    if (resumeFromCallback) {
      // Resume from saved state
      state = loadWorkflowState(pageId);
      if (!state) {
        throw new Error('No saved state found for resuming workflow');
      }
      
      debugLog('🔄 Resuming workflow from step: ' + state.step);
      progressFileName = state.progressFileName;
      updateProgressFile(progressFileName, pageId, `Resuming from step: ${state.step}`);
      
      // Process the callback result
      if (callbackResult && state.step === 'waiting_for_llm') {
        return resumeAfterLLMCallback(pageId, state, callbackResult);
      }
      
    } else {
      // Start new workflow
      CONTENT_ISSUES.length = 0;
      
      timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      progressFileName = `progress_${pageId}_${timestamp}.txt`;
      saveToGoogleDrive(`Processing started at ${new Date().toISOString()}\nPage ID: ${pageId}\n`, progressFileName);
      
      // Fetch page details from Notion
      debugLog('📄 Fetching page details from Notion');
      const pageDetails = fetchNotionPage(pageId);
      
      if (!pageDetails) {
        throw new Error('Failed to fetch page details from Notion');
      }
      
      // Create document structure
      const doc = new DocumentStructure(pageId, pageDetails.title || 'Untitled');
      
      // Fetch page content
      debugLog('📝 Fetching page content');
      const pageContent = fetchNotionPageContent(pageId);
      
      if (!pageContent) {
        throw new Error('Failed to fetch page content');
      }
      
      doc.mainContent = pageContent;
      
      // Clean content for LLM
      debugLog('🧹 Cleaning content for LLM processing');
      doc.cleanedContent = cleanContentForLLM(pageContent);
      
      // Detect if it's a meeting transcription
      doc.detectMeetingTranscription();
      
      // NEW: Extract external links and create index
      debugLog('🔍 Creating content index and extracting external links');
      const foundLinks = extractExternalLinksAndCreateIndex(doc);
      
      // Create raw files for main page and sub-blocks
      debugLog('📁 Creating raw files for indexing');
      const createdFiles = createRawFiles(doc);
      
      // NEW: Initialize page status control
      debugLog('🎛️ Initializing page status control');
      const statusControl = initializePageStatusControl(pageId, doc.index);
      
      debugLog('📊 Indexing completed', {
        pageId: pageId,
        mainPageIndexed: true,
        externalLinksFound: foundLinks,
        totalSubBlocks: doc.index.subBlocks.length,
        totalItems: doc.index.totalItems,
        indexSummary: doc.getIndexSummary(),
        statusControlInitialized: !!statusControl
      });
      
      // Save initial state
      state = {
        step: 'document_fetched',
        doc: {
          pageId: pageId,
          pageTitle: doc.pageTitle,
          mainContent: doc.mainContent,
          cleanedContent: doc.cleanedContent,
          isMeetingTranscription: doc.isMeetingTranscription,
          index: doc.index,
          createdFiles: createdFiles
        },
        progressFileName: progressFileName,
        timestamp: timestamp
      };
      saveWorkflowState(pageId, state);
      
      return startLLMProcessing(pageId, state);
    }
    
  } catch (error) {
    debugLog('❌ Error in processNotionPage', {
      pageId: pageId,
      error: error.toString(),
      stack: error.stack
    });
    
    if (progressFileName) {
      updateProgressFile(progressFileName, pageId, `Error: ${error.toString()}`);
    }
    clearWorkflowState(pageId);
    throw error;
  }
}

// Start LLM processing and save state
function startLLMProcessing(pageId, state) {
  debugLog('🤖 Processing with LLM');
  updateProgressFile(state.progressFileName, pageId, 'Starting LLM processing...');
  
  const doc = state.doc;
  let prompt, rawContent;
  
  if (ACTIVE_LLM === 'zapier_webhook') {
    // For Zapier: prompt = template, raw_text = content
    const zapierStructure = createZapierPromptStructure(
      doc.cleanedContent,
      doc.pageTitle,
      {
        documentType: doc.isMeetingTranscription ? 'meeting' : null,
        promptType: 'mainDocument'
      }
    );
    prompt = zapierStructure.prompt; // The instruction template
    rawContent = zapierStructure.rawContent; // Just the content
  } else {
    // For other LLMs: use the combined template+content
    prompt = createMainPrompt(doc);
    rawContent = doc.cleanedContent;
  }
  
  // Determine if we need to chunk the content
  const maxChunkSize = CHUNK_SIZE || 15000;
  const chunks = doc.cleanedContent.length > maxChunkSize ? 
    chunkContent(doc.cleanedContent, maxChunkSize) : 
    [doc.cleanedContent];
  
  debugLog('📊 Content chunking analysis', {
    contentLength: doc.cleanedContent.length,
    maxChunkSize: maxChunkSize,
    totalChunks: chunks.length,
    needsChunking: chunks.length > 1
  });
  
  // Process first chunk or single content
  const chunkId = `${pageId}_chunk_0`;
  const chunkIndex = 0;
  const totalChunks = chunks.length;
  const currentChunk = chunks[0];
  
  // Update state before calling LLM
  state.step = 'waiting_for_llm';
  state.chunking = {
    totalChunks: totalChunks,
    currentChunkIndex: chunkIndex,
    chunks: chunks,
    processedChunks: [],
    chunkResults: {}
  };
  state.llm_request = {
    prompt: prompt,
    rawContent: rawContent,
    chunkId: chunkId,
    chunkIndex: chunkIndex,
    totalChunks: totalChunks,
    timestamp: new Date().toISOString()
  };
  saveWorkflowState(pageId, state);
  
  // Call LLM without waiting (async) - first chunk
  const taskId = callLLM(prompt, {
    pageId: pageId,
    chunkId: chunkId,
    chunkIndex: chunkIndex,
    totalChunks: totalChunks,
    progressFileName: state.progressFileName,
    rawContent: currentChunk, // Send current chunk content
    metadata: {
      pageTitle: doc.pageTitle,
      pageId: pageId,
      chunkId: chunkId,
      chunkIndex: chunkIndex,
      totalChunks: totalChunks,
      isMeeting: doc.isMeetingTranscription,
      contentLength: currentChunk.length,
      fullContentLength: doc.cleanedContent.length,
      rawContent: currentChunk,
      context: totalChunks > 1 ? 'chunk_processing' : 'main_document',
      mode: 'async_workflow',
      content_cleaned: true,
      issues_count: CONTENT_ISSUES.length,
      provider: LLM_CONFIG.zapier_webhook.defaultProvider,
      model: LLM_CONFIG.zapier_webhook.defaultModel,
      authentication: LLM_CONFIG.zapier_webhook.defaultAuthentication,
      requested_model: LLM_CONFIG.zapier_webhook.defaultModel,
      active_llm: ACTIVE_LLM,
      wait_for_response: false,
      // NEW: Indexing information
      contentType: 'main_page',
      contentId: doc.index.main.contentId,
      itemId: doc.index.main.id,
      totalIndexItems: doc.index.totalItems,
      hasSubBlocks: doc.index.subBlocks.length > 0,
      subBlocksCount: doc.index.subBlocks.length,
      // NEW: Raw file information
      rawFileName: doc.index.main.rawFileName || null,
      rawFileId: doc.index.main.rawFileId || null
    }
  });
  
  // Save taskId to state
  state.taskId = taskId;
  saveWorkflowState(pageId, state);
  
  debugLog('🚀 LLM request sent, workflow paused', { 
    pageId: pageId, 
    taskId: taskId 
  });
  
  // Return immediately - execution will resume on callback
  return {
    mode: 'async_started',
    pageId: pageId,
    taskId: taskId,
    message: 'LLM processing started, waiting for callback'
  };
}

// Resume workflow after LLM callback
function resumeAfterLLMCallback(pageId, state, callbackResult) {
  debugLog('🔄 Resuming after LLM callback', { pageId: pageId });
  
  const doc = state.doc;
  const chunking = state.chunking;
  
  // Store result for the current chunk
  const currentChunkIndex = chunking.currentChunkIndex;
  const chunkId = `${pageId}_chunk_${currentChunkIndex}`;
  
  debugLog('📝 Storing chunk result', {
    chunkIndex: currentChunkIndex,
    chunkId: chunkId,
    totalChunks: chunking.totalChunks,
    resultLength: callbackResult ? callbackResult.length : 0
  });
  
  // Save this chunk's result
  chunking.chunkResults[chunkId] = {
    index: currentChunkIndex,
    result: callbackResult,
    timestamp: new Date().toISOString(),
    chunkLength: chunking.chunks[currentChunkIndex].length
  };
  chunking.processedChunks.push(currentChunkIndex);
  
  updateProgressFile(state.progressFileName, pageId, `Chunk ${currentChunkIndex + 1}/${chunking.totalChunks} completed`);
  
  // Check if we have more chunks to process
  const nextChunkIndex = currentChunkIndex + 1;
  if (nextChunkIndex < chunking.totalChunks) {
    debugLog('🔄 Processing next chunk', {
      nextChunkIndex: nextChunkIndex,
      totalChunks: chunking.totalChunks,
      remainingChunks: chunking.totalChunks - nextChunkIndex
    });
    
    // Update state for next chunk
    chunking.currentChunkIndex = nextChunkIndex;
    state.chunking = chunking;
    
    const nextChunkId = `${pageId}_chunk_${nextChunkIndex}`;
    const nextChunk = chunking.chunks[nextChunkIndex];
    
    // Prepare prompt for next chunk
    let prompt, rawContent;
    
    if (ACTIVE_LLM === 'zapier_webhook') {
      // For Zapier: prompt = template, raw_text = content
      const zapierStructure = createZapierPromptStructure(
        nextChunk,
        doc.pageTitle,
        {
          documentType: doc.isMeetingTranscription ? 'meeting' : null,
          promptType: 'mainDocument'
        }
      );
      prompt = zapierStructure.prompt;
      rawContent = zapierStructure.rawContent;
    } else {
      // For other LLMs: use chunk prompt
      prompt = createChunkPrompt(nextChunk, nextChunkIndex + 1, chunking.totalChunks);
      rawContent = nextChunk;
    }
    
    // Update LLM request state
    state.llm_request = {
      prompt: prompt,
      rawContent: rawContent,
      chunkId: nextChunkId,
      chunkIndex: nextChunkIndex,
      totalChunks: chunking.totalChunks,
      timestamp: new Date().toISOString()
    };
    
    // Save updated state
    saveWorkflowState(pageId, state);
    
    // Call LLM for next chunk
    const taskId = callLLM(prompt, {
      pageId: pageId,
      chunkId: nextChunkId,
      chunkIndex: nextChunkIndex,
      totalChunks: chunking.totalChunks,
      progressFileName: state.progressFileName,
      rawContent: nextChunk,
      metadata: {
        pageTitle: doc.pageTitle,
        pageId: pageId,
        chunkId: nextChunkId,
        chunkIndex: nextChunkIndex,
        totalChunks: chunking.totalChunks,
        isMeeting: doc.isMeetingTranscription,
        contentLength: nextChunk.length,
        fullContentLength: doc.cleanedContent.length,
        rawContent: nextChunk,
        context: 'chunk_processing',
        mode: 'async_workflow',
        content_cleaned: true,
        issues_count: CONTENT_ISSUES.length,
        provider: LLM_CONFIG.zapier_webhook.defaultProvider,
        model: LLM_CONFIG.zapier_webhook.defaultModel,
        authentication: LLM_CONFIG.zapier_webhook.defaultAuthentication,
        requested_model: LLM_CONFIG.zapier_webhook.defaultModel,
        active_llm: ACTIVE_LLM,
        wait_for_response: false,
        // NEW: Indexing information
        contentType: 'main_page',
        contentId: doc.index.main.contentId,
        itemId: doc.index.main.id,
        totalIndexItems: doc.index.totalItems,
        hasSubBlocks: doc.index.subBlocks.length > 0,
        subBlocksCount: doc.index.subBlocks.length,
        // NEW: Raw file information
        rawFileName: doc.index.main.rawFileName || null,
        rawFileId: doc.index.main.rawFileId || null
      }
    });
    
    // Update state with new taskId
    state.taskId = taskId;
    saveWorkflowState(pageId, state);
    
    debugLog('🚀 Next chunk LLM request sent', { 
      pageId: pageId, 
      taskId: taskId,
      chunkIndex: nextChunkIndex,
      nextChunkId: nextChunkId
    });
    
    // Return continuation info
    return {
      mode: 'async_continuing',
      pageId: pageId,
      taskId: taskId,
      currentChunk: nextChunkIndex + 1,
      totalChunks: chunking.totalChunks,
      message: `Processing chunk ${nextChunkIndex + 1}/${chunking.totalChunks}`
    };
    
  } else {
    // All chunks processed - combine results
    debugLog('🎉 All chunks processed, combining results', {
      totalChunks: chunking.totalChunks,
      processedChunks: chunking.processedChunks.length,
      chunkResultsCount: Object.keys(chunking.chunkResults).length
    });
    
    return combineChunkResults(pageId, state);
  }
}

// Combine all chunk results into final summary
function combineChunkResults(pageId, state) {
  debugLog('🔄 Combining chunk results into final summary', { pageId: pageId });
  
  const doc = state.doc;
  const chunking = state.chunking;
  
  // Collect all chunk results in order
  const chunkSummaries = [];
  for (let i = 0; i < chunking.totalChunks; i++) {
    const chunkId = `${pageId}_chunk_${i}`;
    const chunkResult = chunking.chunkResults[chunkId];
    
    if (chunkResult && chunkResult.result) {
      chunkSummaries.push(`## Chunk ${i + 1} of ${chunking.totalChunks}\n\n${chunkResult.result}`);
      debugLog(`✅ Added chunk ${i + 1} result to combination`, {
        chunkId: chunkId,
        resultLength: chunkResult.result.length
      });
    } else {
      debugLog(`⚠️ Missing result for chunk ${i + 1}`, { chunkId: chunkId });
      chunkSummaries.push(`## Chunk ${i + 1} of ${chunking.totalChunks}\n\n[Chunk processing failed or incomplete]`);
    }
  }
  
  updateProgressFile(state.progressFileName, pageId, 'Combining chunk results into final summary...');
  
  // Create combined content from all chunk summaries
  const combinedSummaries = chunkSummaries.join('\n\n---\n\n');
  
  debugLog('📋 Combined chunk summaries', {
    totalChunks: chunking.totalChunks,
    combinedLength: combinedSummaries.length,
    summaryCount: chunkSummaries.length
  });
  
  // If we have multiple chunks, create a final combined summary
  let finalSummary;
  if (chunking.totalChunks > 1) {
    debugLog('🤖 Creating final combined summary for multiple chunks');
    
    // Use combine prompt to create final summary
    const combinePrompt = createCombinePrompt(combinedSummaries);
    
    // For now, use the combined summaries as final result
    // In a real implementation, you might want to send this to LLM again for final processing
    finalSummary = `# Combined Document Summary\n\nThis document was processed in ${chunking.totalChunks} chunks and combined into a unified summary.\n\n## Individual Chunk Summaries\n\n${combinedSummaries}\n\n## Processing Summary\n- Total chunks: ${chunking.totalChunks}\n- Content length: ${doc.cleanedContent.length} characters\n- Processing completed: ${new Date().toISOString()}`;
    
  } else {
    // Single chunk, use the result directly
    finalSummary = chunkSummaries[0] || 'No results available';
  }
  
  // Save results
  debugLog('💾 Saving final combined results');
  const resultsFileName = `summary_${pageId}_${state.timestamp}.md`;
  
  // Format final results
  const resultsContent = `# ${doc.pageTitle}

**Document Type:** ${doc.isMeetingTranscription ? 'Meeting Transcription' : 'Document'}
**Processed:** ${new Date().toISOString()}
**Page ID:** ${pageId}
**Processing Mode:** ${chunking.totalChunks > 1 ? 'Multi-chunk' : 'Single chunk'}
**Total Chunks:** ${chunking.totalChunks}

## Summary

${finalSummary}

## Processing Details
- **Original Content Length:** ${doc.cleanedContent.length} characters
- **Chunks Processed:** ${chunking.totalChunks}
- **Content Issues:** ${CONTENT_ISSUES.length} issues found during processing
- **Chunk Results:** ${Object.keys(chunking.chunkResults).length}/${chunking.totalChunks} successful

## Chunk Processing Summary
${Object.keys(chunking.chunkResults).map(chunkId => {
  const result = chunking.chunkResults[chunkId];
  return `- **Chunk ${result.index + 1}:** ${result.result ? result.result.length + ' characters' : 'Failed'} (${result.timestamp})`;
}).join('\n')}`;

  saveToGoogleDrive(resultsContent, resultsFileName);
  
  // Save content issues log if any were found
  let issuesLogFile = null;
  if (CONTENT_ISSUES.length > 0) {
    issuesLogFile = saveContentIssuesLog(pageId);
    debugLog(`📋 Content issues log saved: ${CONTENT_ISSUES.length} issues found`);
  }
  
  // Save individual chunk results for debugging
  const chunkResultsFileName = `chunk_results_${pageId}_${state.timestamp}.json`;
  const chunkResultsContent = JSON.stringify({
    pageId: pageId,
    pageTitle: doc.pageTitle,
    totalChunks: chunking.totalChunks,
    processedChunks: chunking.processedChunks,
    chunkResults: chunking.chunkResults,
    combinedSummaries: combinedSummaries,
    processingCompleted: new Date().toISOString()
  }, null, 2);
  
  saveToGoogleDrive(chunkResultsContent, chunkResultsFileName);
  
  // Update progress file
  updateProgressFile(state.progressFileName, pageId, `Multi-chunk processing completed successfully!\nResults saved to: ${resultsFileName}\nChunk details: ${chunkResultsFileName}`);
  
  debugLog('✅ Multi-chunk document processing completed', {
    pageId: pageId,
    resultsFile: resultsFileName,
    chunkResultsFile: chunkResultsFileName,
    totalChunks: chunking.totalChunks,
    issuesFound: CONTENT_ISSUES.length
  });
  
  // Send final results to learning webhook
  if (ENABLE_WEBHOOK && WEBHOOK_URL) {
    try {
      debugLog('📤 Sending final results to learning webhook');
      updateProgressFile(state.progressFileName, pageId, 'Sending final results to learning system...');
      
      const webhookPayload = {
        pageId: pageId,
        pageTitle: doc.pageTitle,
        summary: finalSummary,
        contentLength: doc.cleanedContent.length,
        isMeetingTranscription: doc.isMeetingTranscription,
        resultsFileName: resultsFileName,
        chunkResultsFileName: chunkResultsFileName,
        processedAt: new Date().toISOString(),
        issuesFound: CONTENT_ISSUES.length,
        totalChunks: chunking.totalChunks,
        processingMode: 'multi_chunk',
        mode: 'async_completed'
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
      debugLog('📨 Learning webhook response', {
        statusCode: webhookStatus,
        success: webhookStatus >= 200 && webhookStatus < 300
      });
      
      if (webhookStatus >= 200 && webhookStatus < 300) {
        updateProgressFile(state.progressFileName, pageId, 'Final results successfully sent to learning system');
      } else {
        debugLog('⚠️ Learning webhook returned non-success status', {
          statusCode: webhookStatus,
          response: webhookResponse.getContentText()
        });
        updateProgressFile(state.progressFileName, pageId, `Warning: Learning webhook returned status ${webhookStatus}`);
      }
      
    } catch (webhookError) {
      debugLog('❌ Error sending to learning webhook', {
        error: webhookError.toString()
      });
      updateProgressFile(state.progressFileName, pageId, `Warning: Failed to send to learning system - ${webhookError.toString()}`);
    }
  }
  
  // Save debug logs
  const debugFile = saveDebugLogs(pageId);
  
  // Clear workflow state
  clearWorkflowState(pageId);
  
  // Return completion info
  return {
    mode: 'async_completed',
    pageId: pageId,
    resultsFileName: resultsFileName,
    chunkResultsFileName: chunkResultsFileName,
    totalChunks: chunking.totalChunks,
    processedChunks: chunking.processedChunks.length,
    issuesFound: CONTENT_ISSUES.length,
    issuesLogFile: issuesLogFile,
    debugFile: debugFile ? debugFile.getName() : null,
    webhookSent: ENABLE_WEBHOOK && WEBHOOK_URL,
    finalSummaryLength: finalSummary ? finalSummary.length : 0
  };
}

// Create main prompt for LLM using smart templates
function createMainPrompt(doc) {
  // Use the smart prompt creation with template selection
  return createSmartPrompt(
    doc.cleanedContent,
    doc.pageTitle,
    {
      documentType: doc.isMeetingTranscription ? 'meeting' : null,
      promptType: 'mainDocument'
    }
  );
}

// Create chunk prompt for processing large content
function createChunkPrompt(chunkContent, chunkNumber, totalChunks) {
  return processPromptTemplate(
    PROMPT_TEMPLATES.chunk.standard,
    {
      content: chunkContent,
      chunkNumber: chunkNumber,
      totalChunks: totalChunks
    }
  );
}

// Create combine prompt for merging chunk summaries
function createCombinePrompt(combinedSummaries) {
  return processPromptTemplate(
    PROMPT_TEMPLATES.combine.standard,
    {
      summaries: combinedSummaries
    }
  );
}

// Format results for saving
function formatResults(doc) {
  const timestamp = new Date().toISOString();
  
  return `# Notion Page Summary

**Generated:** ${timestamp}
**Page ID:** ${doc.pageId}
**Page Title:** ${doc.pageTitle}
**Document Type:** ${doc.isMeetingTranscription ? 'Meeting Transcription' : 'General Document'}

---

## Summary

${doc.mainSummary}

---

## Processing Details

- **Original Content Length:** ${doc.mainContent?.length || 0} characters
- **Cleaned Content Length:** ${doc.cleanedContent?.length || 0} characters
- **Content Issues Found:** ${CONTENT_ISSUES.length}
- **Unsupported Blocks:** ${doc.unsupportedBlocks.length}
- **External Links:** ${doc.externalLinks.length}

${CONTENT_ISSUES.length > 0 ? `
### Content Issues
${CONTENT_ISSUES.slice(0, 5).map(issue => 
  `- **${issue.type}**: ${issue.description}`
).join('\n')}
${CONTENT_ISSUES.length > 5 ? `\n... and ${CONTENT_ISSUES.length - 5} more issues` : ''}
` : ''}

---

*Processed with ${ACTIVE_LLM.toUpperCase()} LLM*`;
}

// Mock LLM response for testing without API calls
function mockLLMCall(prompt) {
  debugLog('Mock LLM call with prompt length:', prompt.length);
  
  if (prompt.includes('Chunk') && prompt.includes('Summary')) {
    return `## Mock Chunk Summary

### Key Points
- Mock key point from chunk analysis
- Simulated important finding
- Test data point

### Decisions & Actions
- Mock decision identified
- Simulated action item

### Metrics & Data
- Test metric: 85% completion
- Mock user count: 1,234 users

### Technical Information
- Simulated technical progress
- Mock blocker identified and resolved`;
  }
  
  if (prompt.includes('combining multiple chunk summaries')) {
    return `# 🧩 Executive Check-in Summary

## 🎮 Overall Game Team
**Summary:** Mock executive summary combining all chunks. The team is making steady progress with good morale and clear validation signals.

### ✨ Opportunities
- Simulated opportunity for improvement in testing
- Mock potential for increased user engagement

### 🧱 Obstacles
- Test blocker in development pipeline resolved
- Mock dependency on external vendor addressed

### 🎯 This Milestone's Expectations
- Achieve 90% completion rate (currently at 85%)
- Complete mock validation testing by end of sprint

## 🧩 Next Steps
- Continue with mock implementation plan
- Schedule follow-up validation session`;
  }
  
  // Default mock response
  return `# 🧩 Mock Executive Summary

This is a simulated response for testing purposes. The actual LLM would analyze the content and provide structured insights following the Fortis Games template.

## Key Findings
- Mock finding 1: Significant progress in development
- Mock finding 2: User feedback indicates positive reception
- Mock finding 3: Technical challenges have been addressed

## Next Steps
- Continue with planned roadmap
- Address any remaining blockers
- Prepare for next milestone review`;
}