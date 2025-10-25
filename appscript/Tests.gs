// ==================== TEST FUNCTIONS ====================
// All test functions for debugging and validation

// List all webapp doPost debug files from ROOT drive
function listWebappDebugFiles() {
  debugLog('📋 Listing all webapp debug files from ROOT drive');
  
  try {
    const rootFolder = DriveApp.getRootFolder();
    const files = rootFolder.searchFiles('title contains "WEBAPP_DOPOST_"');
    
    const results = [];
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      const created = file.getDateCreated();
      const size = file.getSize();
      
      // Get a preview of the content
      let preview = '';
      try {
        const content = file.getBlob().getDataAsString();
        preview = content.length > 300 ? content.substring(0, 300) + '...' : content;
      } catch (contentError) {
        preview = `Error reading content: ${contentError.toString()}`;
      }
      
      results.push({
        name: fileName,
        created: created,
        size: size,
        preview: preview,
        fileId: file.getId()
      });
    }
    
    // Sort by creation date (newest first)
    results.sort((a, b) => b.created - a.created);
    
    debugLog('✅ Found webapp debug files', {
      totalFiles: results.length,
      files: results.map(f => ({ name: f.name, created: f.created, size: f.size }))
    });
    
    // Print summary to console
    console.log('=== WEBAPP DEBUG FILES ===');
    results.forEach((file, index) => {
      console.log(`${index + 1}. ${file.name}`);
      console.log(`   Created: ${file.created}`);
      console.log(`   Size: ${file.size} bytes`);
      console.log(`   Preview: ${file.preview.substring(0, 150)}`);
      console.log('   ---');
    });
    
    return results;
    
  } catch (error) {
    debugLog('❌ Error listing webapp debug files', { error: error.toString() });
    console.log('Error:', error.toString());
    return [];
  }
}

// Read specific webapp debug file content
function readWebappDebugFile(fileName) {
  debugLog('📖 Reading webapp debug file', { fileName: fileName });
  
  try {
    const rootFolder = DriveApp.getRootFolder();
    const files = rootFolder.getFilesByName(fileName);
    
    if (!files.hasNext()) {
      console.log(`❌ File not found: ${fileName}`);
      return null;
    }
    
    const file = files.next();
    const content = file.getBlob().getDataAsString();
    
    console.log(`=== CONTENT OF ${fileName} ===`);
    console.log(content);
    console.log('=== END OF FILE ===');
    
    return content;
    
  } catch (error) {
    debugLog('❌ Error reading webapp debug file', { fileName: fileName, error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// Clean old webapp debug files (keep only last 10)
function cleanOldWebappDebugFiles() {
  debugLog('🧹 Cleaning old webapp debug files');
  
  try {
    const files = listWebappDebugFiles();
    
    if (files.length <= 10) {
      console.log(`Only ${files.length} files found, no cleaning needed`);
      return;
    }
    
    // Delete files beyond the first 10 (oldest)
    const filesToDelete = files.slice(10);
    let deletedCount = 0;
    
    filesToDelete.forEach(fileInfo => {
      try {
        const file = DriveApp.getFileById(fileInfo.fileId);
        file.setTrashed(true);
        deletedCount++;
        console.log(`Deleted: ${fileInfo.name}`);
      } catch (deleteError) {
        console.log(`Failed to delete ${fileInfo.name}: ${deleteError.toString()}`);
      }
    });
    
    console.log(`✅ Cleaned ${deletedCount} old webapp debug files`);
    debugLog('✅ Webapp debug files cleaned', { deletedCount: deletedCount });
    
  } catch (error) {
    debugLog('❌ Error cleaning webapp debug files', { error: error.toString() });
    console.log('Error:', error.toString());
  }
}

// Check webapp logs from Properties Service (fallback when Drive fails)
function checkWebappLogsFromProperties() {
  debugLog('🔍 Checking webapp logs from Properties Service');
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    
    // Find all webapp logs
    const webappLogs = [];
    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('WEBAPP_LOG_')) {
        try {
          const logData = JSON.parse(allProperties[key]);
          webappLogs.push({
            key: key,
            timestamp: logData.timestamp,
            data: logData
          });
        } catch (parseError) {
          console.log(`Failed to parse log ${key}:`, parseError.toString());
        }
      }
    });
    
    // Sort by timestamp (newest first)
    webappLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    console.log(`=== WEBAPP LOGS FROM PROPERTIES (${webappLogs.length} found) ===`);
    webappLogs.forEach((log, index) => {
      console.log(`${index + 1}. ${log.key}`);
      console.log(`   Timestamp: ${log.timestamp}`);
      console.log(`   Method: ${log.data.method}`);
      console.log(`   Event preview: ${log.data.event.substring(0, 100)}...`);
      console.log(`   Headers: ${log.data.headers}`);
      console.log('   ---');
    });
    
    return webappLogs;
    
  } catch (error) {
    debugLog('❌ Error checking webapp logs from Properties', { error: error.toString() });
    console.log('Error:', error.toString());
    return [];
  }
}

// Export webapp logs from Properties to Drive files
function exportWebappLogsToDriver() {
  debugLog('📤 Exporting webapp logs from Properties to Drive');
  
  try {
    const webappLogs = checkWebappLogsFromProperties();
    
    if (webappLogs.length === 0) {
      console.log('No webapp logs to export');
      return;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let exportContent = `# Webapp Logs Export - ${timestamp}\n\n`;
    
    webappLogs.forEach((log, index) => {
      exportContent += `## Log ${index + 1}: ${log.key}\n`;
      exportContent += `**Timestamp:** ${log.data.timestamp}\n`;
      exportContent += `**Method:** ${log.data.method}\n`;
      exportContent += `**Source:** ${log.data.source || 'unknown'}\n\n`;
      exportContent += `**Headers:**\n\`\`\`json\n${log.data.headers}\n\`\`\`\n\n`;
      exportContent += `**Event:**\n\`\`\`json\n${log.data.event}\n\`\`\`\n\n`;
      exportContent += `---\n\n`;
    });
    
    const exportFileName = `webapp_logs_export_${timestamp}.md`;
    const exportFile = saveToGoogleDrive(exportContent, exportFileName);
    
    console.log(`✅ Exported ${webappLogs.length} webapp logs to: ${exportFileName}`);
    debugLog('✅ Webapp logs exported to Drive', { 
      fileName: exportFileName,
      fileId: exportFile.getId(),
      logCount: webappLogs.length
    });
    
    return {
      fileName: exportFileName,
      fileId: exportFile.getId(),
      logCount: webappLogs.length
    };
    
  } catch (error) {
    debugLog('❌ Error exporting webapp logs to Drive', { error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// ==================== SIMPLE STORAGE LOG VIEWERS ====================

// View all webapp logs from SimpleStorage
function viewWebappLogs(limit = 10) {
  debugLog('📋 Viewing webapp logs from SimpleStorage', { limit: limit });
  
  try {
    // Get storage statistics to find webapp logs
    const stats = getStorageStats();
    if (!stats || !stats.entries) {
      console.log('❌ No storage statistics available');
      return [];
    }
    
    // Filter webapp logs
    const webappLogs = stats.entries.filter(entry => 
      entry.path.startsWith('logs/webapp/')
    );
    
    // Sort by timestamp (newest first)
    webappLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    // Limit results
    const limitedLogs = webappLogs.slice(0, limit);
    
    console.log(`=== WEBAPP LOGS (${limitedLogs.length} of ${webappLogs.length} total) ===`);
    
    for (let i = 0; i < limitedLogs.length; i++) {
      const logEntry = limitedLogs[i];
      console.log(`\n${i + 1}. ${logEntry.path}`);
      console.log(`   Timestamp: ${logEntry.timestamp}`);
      console.log(`   Size: ${logEntry.size} bytes`);
      console.log(`   Source: ${logEntry.source}`);
      console.log(`   Chunked: ${logEntry.chunked}`);
    }
    
    return limitedLogs;
    
  } catch (error) {
    debugLog('❌ Error viewing webapp logs', { error: error.toString() });
    console.log('Error:', error.toString());
    return [];
  }
}

// Read specific webapp log by path or timestamp
function readWebappLog(pathOrTimestamp) {
  debugLog('📖 Reading specific webapp log', { pathOrTimestamp: pathOrTimestamp });
  
  try {
    let fullPath = pathOrTimestamp;
    
    // If it looks like a timestamp, build the full path
    if (!pathOrTimestamp.includes('/')) {
      fullPath = `logs/webapp/${pathOrTimestamp}`;
    }
    
    const logData = loadFromStorage(fullPath);
    
    if (!logData) {
      console.log(`❌ Log not found: ${fullPath}`);
      return null;
    }
    
    console.log(`=== WEBAPP LOG: ${fullPath} ===`);
    console.log(`Timestamp: ${logData.content.timestamp}`);
    console.log(`Method: ${logData.content.method}`);
    console.log(`Source: ${logData.content.source}`);
    console.log(`User Agent: ${logData.content.userAgent}`);
    console.log('');
    console.log('Headers:');
    console.log(logData.content.headers);
    console.log('');
    console.log('Event:');
    console.log(logData.content.event);
    console.log('=== END OF LOG ===');
    
    return logData.content;
    
  } catch (error) {
    debugLog('❌ Error reading webapp log', { 
      pathOrTimestamp: pathOrTimestamp,
      error: error.toString() 
    });
    console.log('Error:', error.toString());
    return null;
  }
}

// Export webapp logs to a single readable format
function exportWebappLogsToText(limit = 20) {
  debugLog('📤 Exporting webapp logs to text format', { limit: limit });
  
  try {
    const logs = viewWebappLogs(limit);
    
    if (logs.length === 0) {
      console.log('No webapp logs to export');
      return null;
    }
    
    let exportContent = `# Webapp Logs Export\n`;
    exportContent += `Generated: ${new Date().toISOString()}\n`;
    exportContent += `Total logs exported: ${logs.length}\n\n`;
    exportContent += `---\n\n`;
    
    for (let i = 0; i < logs.length; i++) {
      const logEntry = logs[i];
      const logData = loadFromStorage(logEntry.path);
      
      if (logData && logData.content) {
        exportContent += `## Log ${i + 1}: ${logEntry.path}\n\n`;
        exportContent += `**Timestamp:** ${logData.content.timestamp}\n`;
        exportContent += `**Method:** ${logData.content.method}\n`;
        exportContent += `**Source:** ${logData.content.source}\n`;
        exportContent += `**User Agent:** ${logData.content.userAgent}\n\n`;
        
        exportContent += `**Headers:**\n\`\`\`json\n${logData.content.headers}\n\`\`\`\n\n`;
        
        exportContent += `**Event:**\n\`\`\`json\n${logData.content.event}\n\`\`\`\n\n`;
        exportContent += `---\n\n`;
      }
    }
    
    // Save the export using SimpleStorage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = `exports/webapp_logs_${timestamp}`;
    
    const saveResult = saveToStorage(exportPath, exportContent, {
      type: 'export',
      format: 'markdown',
      logCount: logs.length
    });
    
    if (saveResult.success) {
      console.log(`✅ Webapp logs exported to: ${exportPath}`);
      console.log(`Export size: ${saveResult.size} bytes`);
      console.log(`Source: ${saveResult.source}`);
      
      return {
        path: exportPath,
        size: saveResult.size,
        logCount: logs.length,
        content: exportContent
      };
    } else {
      console.log('❌ Failed to save export:', saveResult.error);
      return null;
    }
    
  } catch (error) {
    debugLog('❌ Error exporting webapp logs', { error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// Clean old webapp logs (older than specified hours)
function cleanOldWebappLogs(olderThanHours = 24) {
  debugLog('🧹 Cleaning old webapp logs', { olderThanHours: olderThanHours });
  
  try {
    const stats = getStorageStats();
    if (!stats || !stats.entries) {
      console.log('❌ No storage statistics available');
      return 0;
    }
    
    const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
    let cleanedCount = 0;
    
    // Filter webapp logs that are old
    const oldLogs = stats.entries.filter(entry => {
      if (!entry.path.startsWith('logs/webapp/')) return false;
      
      const entryTime = new Date(entry.timestamp);
      return entryTime < cutoffTime;
    });
    
    console.log(`Found ${oldLogs.length} old webapp logs to clean`);
    
    // Delete old logs
    oldLogs.forEach(logEntry => {
      try {
        const deleteResult = deleteFromStorage(logEntry.path);
        if (deleteResult.success) {
          cleanedCount++;
          console.log(`Deleted: ${logEntry.path}`);
        } else {
          console.log(`Failed to delete: ${logEntry.path}`);
        }
      } catch (deleteError) {
        console.log(`Error deleting ${logEntry.path}:`, deleteError.toString());
      }
    });
    
    console.log(`✅ Cleaned ${cleanedCount} old webapp logs`);
    debugLog('✅ Webapp logs cleanup completed', { cleanedCount: cleanedCount });
    
    return cleanedCount;
    
  } catch (error) {
    debugLog('❌ Error cleaning old webapp logs', { error: error.toString() });
    console.log('Error:', error.toString());
    return 0;
  }
}

// Get webapp logs summary statistics
function getWebappLogsSummary() {
  debugLog('📊 Getting webapp logs summary');
  
  try {
    const stats = getStorageStats();
    if (!stats || !stats.entries) {
      console.log('❌ No storage statistics available');
      return null;
    }
    
    // Filter webapp logs
    const webappLogs = stats.entries.filter(entry => 
      entry.path.startsWith('logs/webapp/')
    );
    
    const summary = {
      totalLogs: webappLogs.length,
      totalSize: webappLogs.reduce((sum, log) => sum + log.size, 0),
      oldestLog: null,
      newestLog: null,
      sources: {},
      hourlyDistribution: {}
    };
    
    if (webappLogs.length > 0) {
      // Sort by timestamp
      webappLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      summary.oldestLog = webappLogs[0].timestamp;
      summary.newestLog = webappLogs[webappLogs.length - 1].timestamp;
      
      // Count by source and hour
      webappLogs.forEach(log => {
        // Count sources
        if (!summary.sources[log.source]) {
          summary.sources[log.source] = 0;
        }
        summary.sources[log.source]++;
        
        // Count by hour
        const hour = new Date(log.timestamp).getHours();
        if (!summary.hourlyDistribution[hour]) {
          summary.hourlyDistribution[hour] = 0;
        }
        summary.hourlyDistribution[hour]++;
      });
    }
    
    console.log('=== WEBAPP LOGS SUMMARY ===');
    console.log(`Total logs: ${summary.totalLogs}`);
    console.log(`Total size: ${summary.totalSize} bytes`);
    console.log(`Oldest log: ${summary.oldestLog || 'None'}`);
    console.log(`Newest log: ${summary.newestLog || 'None'}`);
    console.log('Sources:', summary.sources);
    console.log('Hourly distribution:', summary.hourlyDistribution);
    
    return summary;
    
  } catch (error) {
    debugLog('❌ Error getting webapp logs summary', { error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// Clear webapp logs from Properties Service
function clearWebappLogsFromProperties() {
  debugLog('🧹 Clearing webapp logs from Properties Service');
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    
    let clearedCount = 0;
    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('WEBAPP_LOG_')) {
        scriptProperties.deleteProperty(key);
        clearedCount++;
      }
    });
    
    console.log(`✅ Cleared ${clearedCount} webapp logs from Properties Service`);
    debugLog('✅ Webapp logs cleared from Properties', { clearedCount: clearedCount });
    
    return clearedCount;
    
  } catch (error) {
    debugLog('❌ Error clearing webapp logs from Properties', { error: error.toString() });
    console.log('Error:', error.toString());
    return 0;
  }
}

// ==================== PROPERTIES STORAGE TESTS ====================

// Test Properties storage system functionality
function testPropertiesStorage() {
  debugLog('🧪 Testing Properties storage system functionality');
  
  console.log('📋 Storage Config:');
  console.log(`  - Max Chunk Size: ${STORAGE_CONFIG.maxChunkSize} bytes`);
  console.log(`  - Max Total Size: ${STORAGE_CONFIG.maxTotalSize} bytes`);
  console.log(`  - Auto Cleanup: ${STORAGE_CONFIG.autoCleanup}`);
  console.log(`  - Max Entries: ${STORAGE_CONFIG.maxEntries}`);
  console.log('');
  
  try {
    // Test 1: Small data storage
    console.log('🧪 Test 1: Small data storage...');
    const smallData = 'This is a test of small data storage in Properties Service';
    const saveResult1 = saveToStorage('test/small_data', smallData, { 
      type: 'test', 
      size: 'small'
    });
    
    console.log('Small save result:', saveResult1);
    
    if (saveResult1.success) {
      const loadResult1 = loadFromStorage('test/small_data');
      console.log('Small load result:', {
        hasContent: !!loadResult1?.content,
        contentLength: loadResult1?.content?.length || 0,
        hasMetadata: !!loadResult1?.metadata
      });
      
      if (loadResult1 && loadResult1.content === smallData) {
        console.log('✅ Small data test: PASSED');
      } else {
        console.log('❌ Small data test: FAILED');
      }
    }
    
    // Test 2: Large data storage with chunking
    console.log('🧪 Test 2: Large data storage (chunking)...');
    const largeData = 'Large data test: ' + 'A'.repeat(600000); // 600KB
    const saveResult2 = saveToStorage('test/large_data', largeData, { 
      type: 'test', 
      size: 'large'
    });
    
    console.log('Large save result:', saveResult2);
    
    if (saveResult2.success) {
      const loadResult2 = loadFromStorage('test/large_data');
      console.log('Large load result size:', loadResult2?.content?.length || 0);
      
      if (loadResult2 && loadResult2.content === largeData) {
        console.log('✅ Large data test: PASSED');
      } else {
        console.log('❌ Large data test: FAILED');
      }
    }
    
    // Test 3: Specialized functions
    console.log('🧪 Test 3: Specialized save/load functions...');
    const testPageId = 'test-page-123';
    const testItemId = 'test-item-456';
    const testContent = 'This is test content for specialized functions';
    
    // Test raw file save/load
    const rawSaveResult = saveRawFile(testPageId, testItemId, 'main_page', testContent);
    console.log('Raw file save result:', rawSaveResult.success);
    
    if (rawSaveResult.success) {
      const rawLoadResult = loadRawFile(testPageId, testItemId, 'main_page');
      const rawTestPassed = rawLoadResult && rawLoadResult.content === testContent;
      console.log('✅ Raw file test:', rawTestPassed ? 'PASSED' : 'FAILED');
    }
    
    // Test 4: Storage statistics
    console.log('🧪 Test 4: Storage statistics...');
    const stats = getStorageStats();
    console.log('Storage stats:', {
      totalEntries: stats?.properties?.storage || 0,
      totalSize: stats?.sizes?.total || 0,
      largestEntry: stats?.sizes?.largest || 0,
      chunksCount: stats?.properties?.chunks || 0
    });
    
    // Test 5: Cleanup
    console.log('🧪 Test 5: Cleanup...');
    const deleteResult1 = deleteFromStorage('test/small_data');
    const deleteResult2 = deleteFromStorage('test/large_data');
    const deleteResult3 = deleteFromStorage(`${STORAGE_CONFIG.rawFilesPath}/${testPageId}/${testItemId}_main_page`);
    
    console.log('Delete results:', { 
      small: deleteResult1.success, 
      large: deleteResult2.success,
      raw: deleteResult3.success
    });
    
    return {
      success: true,
      smallDataTest: saveResult1?.success || false,
      largeDataTest: saveResult2?.success || false,
      specializedTest: rawSaveResult?.success || false,
      storageStats: stats,
      cleanup: deleteResult1.success && deleteResult2.success && deleteResult3.success
    };
    
  } catch (error) {
    debugLog('❌ Error testing Properties storage', { error: error.toString() });
    console.log('Error:', error.toString());
    return { success: false, error: error.toString() };
  }
}

// ==================== DOPOST LOG VIEWER ====================

// View the current webapp doPost log from Drive
function viewCurrentDoPostLog() {
  console.log('=== CURRENT DOPOST LOG FROM DRIVE ===');
  
  try {
    const targetFolderId = '193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ';
    
    const folder = DriveApp.getFolderById(targetFolderId);
    const logFiles = folder.getFilesByName('current_webapp_dopost.txt');
    
    if (!logFiles.hasNext()) {
      console.log('❌ No current doPost log found in Drive folder');
      console.log(`📁 Folder ID: ${targetFolderId}`);
      console.log('💡 The log is created when doPost is called via webapp');
      return null;
    }
    
    const logFile = logFiles.next();
    const logContent = logFile.getBlob().getDataAsString();
    
    console.log(`📄 File ID: ${logFile.getId()}`);
    console.log(`📁 Folder ID: ${targetFolderId}`);
    console.log(`📅 Last Modified: ${logFile.getDateCreated()}`);
    console.log(`📏 Size: ${logFile.getSize()} bytes`);
    console.log('');
    console.log('📋 LOG CONTENT:');
    console.log(logContent);
    
    return {
      fileId: logFile.getId(),
      folderId: targetFolderId,
      lastModified: logFile.getDateCreated(),
      size: logFile.getSize(),
      content: logContent
    };
    
  } catch (error) {
    console.log('❌ Error viewing doPost log from Drive:', error.toString());
    
    // Fallback: check root Drive
    try {
      console.log('🔍 Checking root Drive as fallback...');
      const rootFiles = DriveApp.getFilesByName('current_webapp_dopost.txt');
      
      if (rootFiles.hasNext()) {
        const logFile = rootFiles.next();
        const logContent = logFile.getBlob().getDataAsString();
        
        console.log('📋 Found log in root Drive:');
        console.log(logContent);
        
        return {
          fileId: logFile.getId(),
          folderId: 'root',
          content: logContent
        };
      } else {
        console.log('❌ No log found in root Drive either');
      }
    } catch (rootError) {
      console.log('❌ Root Drive check also failed:', rootError.toString());
    }
    
    return null;
  }
}

// Clear the current doPost log manually from Drive
function clearCurrentDoPostLog() {
  console.log('🧹 Clearing current doPost log from Drive...');
  
  try {
    const targetFolderId = '193zzskBa4U-LWQRw3fjclGJa7Gp-WCSZ';
    let deletedCount = 0;
    
    // Clear from target folder
    try {
      const folder = DriveApp.getFolderById(targetFolderId);
      const logFiles = folder.getFilesByName('current_webapp_dopost.txt');
      
      while (logFiles.hasNext()) {
        const file = logFiles.next();
        file.setTrashed(true);
        deletedCount++;
      }
      
      if (deletedCount > 0) {
        console.log(`✅ Cleared ${deletedCount} log file(s) from target folder`);
      } else {
        console.log('📋 No log files found in target folder');
      }
    } catch (folderError) {
      console.log('⚠️ Error accessing target folder:', folderError.toString());
    }
    
    // Also clear from root Drive (fallback location)
    try {
      const rootFiles = DriveApp.getFilesByName('current_webapp_dopost.txt');
      let rootDeleted = 0;
      
      while (rootFiles.hasNext()) {
        const file = rootFiles.next();
        file.setTrashed(true);
        rootDeleted++;
      }
      
      if (rootDeleted > 0) {
        console.log(`✅ Also cleared ${rootDeleted} log file(s) from root Drive`);
        deletedCount += rootDeleted;
      }
    } catch (rootError) {
      console.log('⚠️ Error clearing from root Drive:', rootError.toString());
    }
    
    console.log(`🎉 Total files cleared: ${deletedCount}`);
    return deletedCount > 0;
    
  } catch (error) {
    console.log('❌ Error clearing doPost log:', error.toString());
    return false;
  }
}

// Test the new doPost logging system
function testDoPostLogging() {
  console.log('🧪 Testing doPost logging system...');
  
  try {
    // Test 1: Call doPost and check if log is created
    console.log('📋 Step 1: Calling doPost with test data...');
    
    const mockEvent = {
      postData: {
        contents: JSON.stringify({
          pageId: 'test-log-page-123',
          action: 'test_logging',
          timestamp: new Date().toISOString()
        }),
        type: 'application/json',
        length: 150,
        name: 'postData'
      },
      parameter: {
        test: 'logging-test',
        userAgent: 'TestAgent/1.0',
        requestUrl: 'https://script.google.com/test'
      },
      headers: {
        'User-Agent': 'TestAgent/1.0',
        'Content-Type': 'application/json',
        'X-Forwarded-For': '127.0.0.1',
        'Authorization': 'Bearer test-token',
        'Custom-Header': 'test-value'
      },
      queryString: 'param1=value1&param2=value2',
      contextPath: '/test',
      contentLength: 150,
      pathInfo: '/webhook',
      authMode: 'REQUIRED'
    };
    
    const doPostResult = doPost(mockEvent);
    console.log('✅ doPost executed');
    
    // Test 2: Check if log was created
    console.log('📋 Step 2: Checking if log was created...');
    
    // Wait a moment for the log to be saved
    Utilities.sleep(1000);
    
    const logData = loadFromStorage('logs/current_webapp_dopost');
    
    if (logData) {
      console.log('✅ Log found in storage');
      console.log(`  - Timestamp: ${logData.content.timestamp}`);
      console.log(`  - Event size: ${logData.content.event.length} chars`);
      console.log(`  - Headers size: ${logData.content.headers.length} chars`);
    } else {
      console.log('❌ No log found in storage');
    }
    
    // Test 3: Call doPost again to test cleanup
    console.log('📋 Step 3: Testing log cleanup with second call...');
    
    const mockEvent2 = {
      postData: {
        contents: JSON.stringify({
          pageId: 'test-log-page-456',
          action: 'test_cleanup',
          timestamp: new Date().toISOString()
        }),
        type: 'application/json'
      },
      parameter: {
        test: 'cleanup-test',
        userAgent: 'TestAgent/2.0'
      }
    };
    
    const doPostResult2 = doPost(mockEvent2);
    console.log('✅ Second doPost executed');
    
    // Check if the log was updated (not duplicated)
    Utilities.sleep(1000);
    const logData2 = loadFromStorage('logs/current_webapp_dopost');
    
    if (logData2) {
      console.log('✅ Log updated successfully');
      console.log(`  - New timestamp: ${logData2.content.timestamp}`);
      console.log(`  - Should be different from first: ${logData2.content.timestamp !== logData.content.timestamp}`);
    }
    
    console.log('🎉 doPost logging test completed');
    
    return {
      success: true,
      firstLogCreated: !!logData,
      secondLogUpdated: !!logData2,
      cleanupWorking: logData2?.content?.timestamp !== logData?.content?.timestamp
    };
    
  } catch (error) {
    console.log('❌ Error testing doPost logging:', error.toString());
    return { success: false, error: error.toString() };
  }
}

// Quick storage overview
function showStorageOverview() {
  console.log('=== STORAGE OVERVIEW ===');
  
  const stats = getStorageStats();
  if (!stats) {
    console.log('❌ Unable to get storage statistics');
    return;
  }
  
  console.log(`Total Properties: ${stats.properties.total}`);
  console.log(`Storage Entries: ${stats.properties.storage}`);
  console.log(`Chunks: ${stats.properties.chunks}`);
  console.log(`Metadata: ${stats.properties.metadata}`);
  console.log(`Other Properties: ${stats.properties.other}`);
  console.log('');
  console.log(`Total Size: ${stats.sizes.total} bytes`);
  console.log(`Average Size: ${stats.sizes.average} bytes`);
  console.log(`Largest Entry: ${stats.sizes.largest} bytes`);
  console.log('');
  
  if (stats.entries.length > 0) {
    console.log('Top 5 largest entries:');
    stats.entries.slice(0, 5).forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.path} (${entry.size} bytes, ${entry.type})`);
    });
  }
  
  return stats;
}

// Test simple POST to doPost function directly
function testDoPostDirect() {
  debugLog('🧪 Testing doPost function directly');
  
  try {
    // Create a mock event object like what webapp receives
    const mockEvent = {
      postData: {
        contents: JSON.stringify({
          pageId: 'test-page-12345',
          action: 'test',
          timestamp: new Date().toISOString()
        }),
        type: 'application/json'
      },
      parameter: {
        test: 'direct-call'
      }
    };
    
    console.log('📋 Calling doPost directly with mock event...');
    const result = doPost(mockEvent);
    
    console.log('✅ doPost completed successfully');
    console.log('📄 Response:', result.getContent());
    
    // Check if logs were created immediately
    console.log('🔍 Checking for created logs...');
    
    console.log('📂 Drive files:');
    const driveFiles = listWebappDebugFiles();
    
    console.log('📊 Properties logs:');
    const propertyLogs = checkWebappLogsFromProperties();
    
    return result;
    
  } catch (error) {
    debugLog('❌ Error testing doPost directly', { error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// Test simple storage system functionality
function testSimpleStorage() {
  debugLog('🧪 Testing simple storage system functionality');
  
  console.log('📋 Storage Config:');
  console.log(`  - Cache Enabled: ${STORAGE_CONFIG.cacheEnabled}`);
  console.log(`  - Max Chunk Size: ${STORAGE_CONFIG.maxChunkSize} bytes`);
  console.log(`  - Cache Expiry: ${STORAGE_CONFIG.cacheExpiry} seconds`);
  console.log(`  - Auto Cleanup: ${STORAGE_CONFIG.autoCleanup}`);
  console.log('');
  
  try {
    // Test 1: Small temporary data (should use Cache)
    console.log('🧪 Test 1: Small temporary data (Cache)...');
    const smallTempData = 'This is a test of small temporary data storage';
    const saveResult1 = saveToStorage('test/small_temp', smallTempData, { 
      type: 'test', 
      size: 'small',
      temporary: true 
    });
    
    console.log('Small temp save result:', saveResult1);
    
    if (saveResult1.success) {
      const loadResult1 = loadFromStorage('test/small_temp');
      console.log('Small temp load result:', loadResult1);
      
      if (loadResult1 && loadResult1.content === smallTempData) {
        console.log('✅ Small temporary data test: PASSED');
      } else {
        console.log('❌ Small temporary data test: FAILED');
      }
    }
    
    // Test 2: Large data (should use Properties with chunking)
    console.log('🧪 Test 2: Large data (Properties with chunking)...');
    const largeData = 'Large data test: ' + 'A'.repeat(600000); // 600KB
    const saveResult2 = saveToStorage('test/large_data', largeData, { 
      type: 'test', 
      size: 'large' 
    });
    
    console.log('Large save result:', saveResult2);
    
    if (saveResult2.success) {
      const loadResult2 = loadFromStorage('test/large_data');
      console.log('Large load result size:', loadResult2?.content?.length || 0);
      
      if (loadResult2 && loadResult2.content === largeData) {
        console.log('✅ Large data test: PASSED');
      } else {
        console.log('❌ Large data test: FAILED');
      }
    }
    
    // Test 3: Storage statistics
    console.log('🧪 Test 3: Storage statistics...');
    const stats = getStorageStats();
    console.log('Storage stats:', {
      totalEntries: stats?.properties?.storage || 0,
      totalSize: stats?.sizes?.total || 0,
      largestEntry: stats?.sizes?.largest || 0
    });
    
    // Test 4: Cleanup
    console.log('🧪 Test 4: Cleanup...');
    const deleteResult1 = deleteFromStorage('test/small_temp');
    const deleteResult2 = deleteFromStorage('test/large_data');
    console.log('Delete results:', { small: deleteResult1.success, large: deleteResult2.success });
    
    return {
      success: true,
      smallTempTest: saveResult1?.success || false,
      largeDataTest: saveResult2?.success || false,
      storageStats: stats,
      cleanup: deleteResult1.success && deleteResult2.success
    };
    
  } catch (error) {
    debugLog('❌ Error testing simple storage', { error: error.toString() });
    console.log('Error:', error.toString());
    return { success: false, error: error.toString() };
  }
}

// Test Google Sheets access in webapp context
function testSheetsAccessInWebapp() {
  debugLog('🧪 Testing Google Sheets access in webapp context');
  
  try {
    // Test 1: Try to create a new spreadsheet
    console.log('📊 Testing Sheets creation...');
    try {
      const testSheet = SpreadsheetApp.create('Test Webapp Sheets Access');
      const sheetId = testSheet.getId();
      console.log('✅ Sheets creation: OK', sheetId);
      
      // Test writing data
      testSheet.getActiveSheet().getRange('A1').setValue('Test from webapp');
      console.log('✅ Sheets writing: OK');
      
      // Test reading data
      const readValue = testSheet.getActiveSheet().getRange('A1').getValue();
      console.log('✅ Sheets reading: OK', readValue);
      
      // Clean up - delete test sheet
      DriveApp.getFileById(sheetId).setTrashed(true);
      console.log('✅ Test sheet cleaned up');
      
      return { sheetsAccess: true, details: 'Full access to Sheets' };
      
    } catch (sheetsError) {
      console.log('❌ Sheets access: FAILED -', sheetsError.toString());
      return { sheetsAccess: false, error: sheetsError.toString() };
    }
    
  } catch (error) {
    debugLog('❌ Error testing Sheets access', { error: error.toString() });
    console.log('Error:', error.toString());
    return { sheetsAccess: false, error: error.toString() };
  }
}

// Test webhook deployment and permissions
function testWebhookDeployment() {
  debugLog('🧪 Testing webhook deployment and permissions');
  
  try {
    // Get the webapp URL
    const webappUrl = ScriptApp.getService().getUrl();
    console.log(`📋 Webapp URL: ${webappUrl}`);
    
    // Test basic permissions
    console.log('🔐 Testing permissions...');
    
    // Test Drive access
    try {
      const rootFolder = DriveApp.getRootFolder();
      console.log('✅ Drive access: OK');
    } catch (driveError) {
      console.log('❌ Drive access: FAILED -', driveError.toString());
    }
    
    // Test Properties access
    try {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('TEST_PERMISSION', 'OK');
      const test = props.getProperty('TEST_PERMISSION');
      props.deleteProperty('TEST_PERMISSION');
      console.log('✅ Properties access: OK');
    } catch (propError) {
      console.log('❌ Properties access: FAILED -', propError.toString());
    }
    
    // Test deployment info
    console.log('📋 Deployment info:');
    console.log(`   - URL: ${webappUrl}`);
    console.log(`   - Execute as: Check deployment settings`);
    console.log(`   - Who has access: Check deployment settings`);
    
    return {
      webappUrl: webappUrl,
      driveAccess: true,
      propertiesAccess: true
    };
    
  } catch (error) {
    debugLog('❌ Error testing webhook deployment', { error: error.toString() });
    console.log('Error:', error.toString());
    return null;
  }
}

// Test Zapier webhook payload
function testZapierPayload() {
  console.log('🧪 Testing Zapier webhook payload...');
  
  const testPrompt = 'Test prompt for Zapier';
  const testRawContent = 'This is test raw content that should be sent as raw_text';
  
  try {
    // Test payload creation without actually sending to Zapier
    const options = {
      rawContent: testRawContent,
      metadata: {
        pageTitle: 'Test Page',
        rawContent: testRawContent + ' (from metadata)',
        provider: 'openai',
        model: 'gpt-4'
      }
    };
    
    // Call the webhook function
    console.log('📤 About to call Zapier webhook with test data...');
    const result = callZapierWebhook(testPrompt, options);
    
    console.log('✅ Zapier webhook test result:', result);
    return { success: true, result: result };
    
  } catch (error) {
    console.error('❌ Zapier webhook test error:', error);
    return { success: false, error: error.toString() };
  }
}

// Simulate Notion webhook call (for when Notion webhook is disabled)
function simulateNotionWebhook() {
  console.log('🎭 Simulating Notion webhook call...');
  
  const mockNotionPayload = {
    data: {
      id: '2963f0b3-b6ab-81c4-afb7-f2f45d303302'
    },
    mode: 'notion_process'
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(mockNotionPayload)
    }
  };
  
  try {
    const result = doPost(mockEvent);
    const response = JSON.parse(result.getContent());
    
    console.log('✅ Notion webhook simulation result:', response);
    return response;
    
  } catch (error) {
    console.error('❌ Notion webhook simulation error:', error);
    return { success: false, error: error.toString() };
  }
}

// Test individual Zapier callback
function testZapierCallback() {
  console.log('🧪 Testing individual Zapier callback...');
  
  const testResult = `## Chunk 1 Summary

### Key Points
- Test point 1: System validation successful
- Test point 2: Performance metrics within range
- Test point 3: User engagement indicators positive

### Decisions & Actions
- Action: Continue with current implementation
- Decision: Approve next phase development

### Metrics & Data
- Test metric: 95% success rate
- Performance: 2.3s average response time

### Technical Information
- Status: All systems operational
- Dependencies: No blockers identified`;

  const mockPayload = {
    Result: testResult,
    request_id: 'test_' + new Date().getTime(),
    chunk_number: 1,
    total_chunks: 1,
    provider: 'openai',
    model: 'gpt-4'
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(mockPayload)
    }
  };
  
  try {
    const result = doPost(mockEvent);
    const response = JSON.parse(result.getContent());
    
    console.log('✅ Zapier callback test result:', response);
    return response;
    
  } catch (error) {
    console.error('❌ Zapier callback test error:', error);
    return { success: false, error: error.toString() };
  }
}

// ==================== LLM TESTING FUNCTIONS ====================

// Test Gemini API with predefined prompt
function testGemini() {
  console.log('[TEST] Gemini API');
  const expectedResponse = 'Gemini API is working correctly.';
  const testPrompt = "Please respond with exactly: '" + expectedResponse + "'";

  try {
    const result = callGemini(testPrompt);
    if (result) {
      console.log('[TEST] Gemini Response:', result);
      const normalized = result.trim();

      if (normalized !== expectedResponse) {
        console.log('[TEST] Gemini response did not match expected text', {
          expected: expectedResponse,
          received: normalized
        });
      }

      return result;
    } else {
      console.log('[TEST] Gemini returned null response');
      return null;
    }
  } catch (error) {
    console.error('[TEST] Gemini test failed:', error);
    return null;
  }
}

// Test OpenAI API with predefined prompt
function testOpenAI() {
  console.log('🔬 Testing OpenAI API...');
  const testPrompt = "Please respond with exactly: 'OpenAI API is working correctly ✅'";
  
  try {
    const result = callOpenAI(testPrompt);
    if (result) {
      console.log('✅ OpenAI Response:', result);
      return result;
    } else {
      console.log('❌ OpenAI returned null response');
      return null;
    }
  } catch (error) {
    console.error('❌ OpenAI test failed:', error);
    return null;
  }
}

// Test Claude API with predefined prompt
function testClaude() {
  console.log('🔬 Testing Claude API...');
  const testPrompt = "Please respond with exactly: 'Claude API is working correctly ✅'";
  
  try {
    const result = callClaude(testPrompt);
    if (result) {
      console.log('✅ Claude Response:', result);
      return result;
    } else {
      console.log('❌ Claude returned null response');
      return null;
    }
  } catch (error) {
    console.error('❌ Claude test failed:', error);
    return null;
  }
}

// Test all LLMs at once
function testAllLLMs() {
  console.log('🧪 Testing All LLM APIs...');
  console.log('================================');
  
  const results = {
    gemini: testGemini(),
    openai: testOpenAI(),
    claude: testClaude()
  };
  
  console.log('================================');
  console.log('📊 Test Results Summary:');
  console.log('- Gemini:', results.gemini ? '✅ Working' : '❌ Failed');
  console.log('- OpenAI:', results.openai ? '✅ Working' : '❌ Failed');
  console.log('- Claude:', results.claude ? '✅ Working' : '❌ Failed');
  
  return results;
}

// Test the currently active LLM
function testActiveLLM() {
  console.log(`🎯 Testing Active LLM: ${ACTIVE_LLM.toUpperCase()}`);
  const testPrompt = `Please respond with exactly: '${ACTIVE_LLM.toUpperCase()} API is working correctly ✅'`;
  
  try {
    const result = callLLM(testPrompt);
    if (result) {
      console.log(`✅ ${ACTIVE_LLM.toUpperCase()} Response:`, result);
      return result;
    } else {
      console.log(`❌ ${ACTIVE_LLM.toUpperCase()} returned null response`);
      return null;
    }
  } catch (error) {
    console.error(`❌ ${ACTIVE_LLM.toUpperCase()} test failed:`, error);
    return null;
  }
}

// Test function for debugging with the new test page ID (ORIGINAL - uses direct LLM)
function testAdvancedSummarizer() {
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  // Updated test page ID as requested
  const testPageId = '28e3f0b3-b6ab-80f4-8680-e89decac5b1f';
  
  try {
    console.log(`Testing Advanced Summarizer with ${ACTIVE_LLM.toUpperCase()}`);
    console.log(`Processing page ID: ${testPageId}`);
    console.log('🔄 Checking for existing files to avoid unnecessary LLM calls...');
    
    const doc = processNotionDocument(testPageId);
    console.log('📊 Document processing complete:');
    console.log(`- Page Title: ${doc.pageTitle}`);
    console.log(`- Content Length: ${doc.mainContent.length} characters`);
    console.log(`- Is Meeting: ${doc.isMeetingTranscription}`);
    console.log(`- External Links: ${doc.externalLinks.length}`);
    console.log(`- Unsupported Blocks: ${doc.unsupportedBlocks.length}`);
    
    if (doc.unsupportedBlocks.length > 0) {
      console.log('⚠️ Unsupported block types found:');
      const blockTypes = {};
      doc.unsupportedBlocks.forEach(block => {
        blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
      });
      Object.entries(blockTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count} block(s)`);
      });
    }
    
    const savedFiles = saveProcessedDocument(doc);
    
    console.log('✅ Test complete!');
    console.log('📁 Files created/updated:', Object.keys(savedFiles).length);
    
    if (savedFiles.index) {
      console.log('📚 Index URL:', savedFiles.index.getUrl());
    }
    if (savedFiles.main) {
      console.log('📄 Main file:', savedFiles.main.getUrl());
    }
    if (savedFiles.summary) {
      console.log('📝 Summary file:', savedFiles.summary.getUrl());
    }
    
    // List external files
    Object.keys(savedFiles).forEach(key => {
      if (key.startsWith('external_')) {
        console.log(`🔗 External file ${key}:`, savedFiles[key].getUrl());
      }
    });
    
    // Save debug logs if available
    if (DEBUG_LOGS.length > 0) {
      const debugFileName = `test_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      try {
        const debugFile = saveToGoogleDrive(DEBUG_LOGS.join('\n'), debugFileName);
        console.log('🔍 Debug log:', debugFile.getUrl());
      } catch (debugError) {
        console.error('Error saving debug log:', debugError);
      }
    }
    
  } catch (error) {
    console.error('❌ Test setup error:', error);
  }
}

// Simple debug test for chunk processing
function debugChunkTest() {
  console.log('🔧 Debug Chunk Test...');
  
  try {
    const testContent = 'This is test content for debugging the chunk system. It contains enough text to test the chunking functionality.';
    const sessionId = 'debug_' + new Date().getTime();
    
    console.log('✅ Test content created:', testContent.length, 'chars');
    console.log('✅ Session ID:', sessionId);
    
    const result = simulateZapierCallback(sessionId, 1, 1, testContent);
    console.log('✅ Debug test completed:', result ? 'success' : 'failed');
    
    return result;
    
  } catch (error) {
    console.error('❌ Debug test error:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.toString() };
  }
}

// Test content cleaning functionality
function testContentCleaning() {
  console.log('🧹 Testing Content Cleaning...');
  
  // Reset issues
  CONTENT_ISSUES.length = 0;
  
  // Test content with various problematic patterns
  const problemContent = `# Test Document

This is good content.

[Unsupported block type: column_list]
  [Unsupported block type: column]
    Some content in column
  [Unsupported block type: column]
    More column content

[Notion Page: https://www.notion.so/123 - Error: 404 not found]

[Embed: https://example.com/embed]
[End of Notion Block]

[Unsupported block type: table_row]
[Unsupported block type: table_row]

This is more good content that should remain.

[Notion Block Content (table): abc123 - Error: Access denied]

Final good content.`;

  console.log('📝 Original content length:', problemContent.length);
  console.log('🔍 Original content preview:', problemContent.substring(0, 200) + '...');
  
  const cleaned = cleanContentForLLM(problemContent);
  
  console.log('✨ Cleaned content length:', cleaned.length);
  console.log('🧹 Cleaned content preview:', cleaned.substring(0, 200) + '...');
  console.log('⚠️ Issues found:', CONTENT_ISSUES.length);
  
  CONTENT_ISSUES.forEach((issue, index) => {
    console.log(`   ${index + 1}. [${issue.type}] ${issue.description}`);
  });
  
  // Test saving issues log
  const logFile = saveContentIssuesLog('test_page_id');
  if (logFile) {
    console.log('📄 Issues log saved:', logFile.getUrl());
  }
  
  return {
    originalLength: problemContent.length,
    cleanedLength: cleaned.length,
    issuesFound: CONTENT_ISSUES.length,
    cleanedContent: cleaned
  };
}

// Test Notion webhook with real Zapier and wait for result (30s timeout)
function testNotionWebhookWithWait() {
  console.log('🎭 Testing Notion webhook with real Zapier and waiting for result (30s timeout)...');
  
  const mockNotionPayload = {
    data: {
      id: '28e3f0b3-b6ab-80f4-8680-e89decac5b1f'
    },
    mode: 'notion_process'
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(mockNotionPayload)
    }
  };
  
  try {
    console.log('⏰ Starting test - this will wait up to 30 seconds for Zapier result...');
    const startTime = new Date().getTime();
    
    const result = doPost(mockEvent);
    const response = JSON.parse(result.getContent());
    
    const endTime = new Date().getTime();
    const elapsedSeconds = Math.round((endTime - startTime) / 1000);
    
    console.log(`✅ Test completed in ${elapsedSeconds} seconds`);
    console.log('📊 Response:', response);
    
    if (response.mode === 'async_completed') {
      console.log('🎉 SUCCESS: Zapier result received and saved!');
      console.log(`📁 Result file: ${response.resultFileName}`);
      console.log(`🔗 File URL: ${response.resultFileUrl}`);
      console.log(`📊 Processing time: ${response.processingTimeSeconds}s`);
      console.log(`🔄 Polling attempts: ${response.pollingAttempts}`);
    } else if (response.mode === 'async_timeout') {
      console.log('⏰ TIMEOUT: Zapier did not respond in time');
      console.log(`🔄 Polling attempts: ${response.pollingAttempts}`);
    } else {
      console.log('ℹ️ Response mode:', response.mode);
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ Test error:', error);
    return { success: false, error: error.toString() };
  }
}

// Test Notion webhook with infinite wait (RECOMMENDED for slow Zapier)
function testNotionWebhookInfiniteWait() {
  console.log('🎭 Testing Notion webhook with INFINITE WAIT for Zapier result...');
  console.log('⚠️ WARNING: This will wait forever until Zapier responds!');
  console.log('📊 Status updates every 30 seconds');
  
  const mockNotionPayload = {
    data: {
      id: '28e3f0b3-b6ab-80f4-8680-e89decac5b1f'
    },
    mode: 'notion_process'
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(mockNotionPayload)
    }
  };
  
  try {
    console.log('🚀 Starting infinite wait test...');
    const startTime = new Date().getTime();
    
    // Override the processAsyncZapierWorkflow to use infinite wait
    const originalProcessFunction = processAsyncZapierWorkflow;
    
    // Temporarily replace with infinite wait version
    processAsyncZapierWorkflow = function(pageId, taskId, waitForResult = false) {
      if (waitForResult) {
        return waitForZapierResult(taskId, pageId, `processing_${pageId}_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, 0); // 0 = infinite
      }
      return originalProcessFunction(pageId, taskId, waitForResult);
    };
    
    const result = doPost(mockEvent);
    const response = JSON.parse(result.getContent());
    
    // Restore original function
    processAsyncZapierWorkflow = originalProcessFunction;
    
    const endTime = new Date().getTime();
    const elapsedSeconds = Math.round((endTime - startTime) / 1000);
    
    console.log(`✅ Infinite wait test completed in ${elapsedSeconds} seconds`);
    console.log('📊 Response:', response);
    
    if (response.mode === 'async_completed') {
      console.log('🎉 SUCCESS: Zapier result received and saved!');
      console.log(`📁 Result file: ${response.resultFileName}`);
      console.log(`🔗 File URL: ${response.resultFileUrl}`);
      console.log(`📊 Processing time: ${response.processingTimeSeconds}s`);
      console.log(`🔄 Polling attempts: ${response.pollingAttempts}`);
    } else {
      console.log('ℹ️ Response mode:', response.mode);
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ Infinite wait test error:', error);
    return { success: false, error: error.toString() };
  }
}

// Wait for specific task ID (useful for checking existing tasks)
function waitForSpecificTask(taskId, maxWaitSeconds = 0) {
  console.log(`🔍 Waiting for specific task: ${taskId}`);
  console.log(`⏰ Wait mode: ${maxWaitSeconds === 0 ? 'INFINITE' : maxWaitSeconds + ' seconds'}`);
  
  const startTime = new Date().getTime();
  const pollIntervalMs = 2000;
  let attempts = 0;
  
  const waitForever = maxWaitSeconds === 0;
  const maxAttempts = waitForever ? Infinity : Math.ceil((maxWaitSeconds * 1000) / pollIntervalMs);
  
  let lastStatusLog = startTime;
  const statusLogInterval = 30000;
  
  while (attempts < maxAttempts) {
    attempts++;
    const elapsed = new Date().getTime() - startTime;
    const elapsedSeconds = Math.round(elapsed/1000);
    
    if (waitForever && elapsed - lastStatusLog >= statusLogInterval) {
      console.log(`⏰ Still waiting for task ${taskId}... ${elapsedSeconds}s elapsed (attempt ${attempts})`);
      lastStatusLog = elapsed + startTime;
    }
    
    const result = checkForZapierResult(taskId);
    if (result.found) {
      console.log(`🎉 Task ${taskId} completed after ${elapsedSeconds}s and ${attempts} attempts!`);
      console.log(`📄 Content length: ${result.content.length} characters`);
      
      return {
        success: true,
        taskId: taskId,
        content: result.content,
        fileName: result.fileName,
        processingTimeSeconds: elapsedSeconds,
        pollingAttempts: attempts
      };
    }
    
    if (attempts < maxAttempts) {
      Utilities.sleep(pollIntervalMs);
    }
  }
  
  console.log(`⏰ Timeout waiting for task ${taskId} after ${Math.round((new Date().getTime() - startTime)/1000)}s`);
  return {
    success: false,
    taskId: taskId,
    error: `Timeout after ${maxWaitSeconds} seconds`,
    pollingAttempts: attempts
  };
}

// List pending async tasks
function listPendingAsyncTasks() {
  console.log('📋 Checking for pending async tasks...');
  
  try {
    const props = PropertiesService.getScriptProperties();
    const allProperties = props.getProperties();
    
    const pendingTasks = [];
    
    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('ASYNC_TASK_')) {
        try {
          const taskInfo = JSON.parse(allProperties[key]);
          pendingTasks.push({
            key: key,
            ...taskInfo
          });
        } catch (parseError) {
          console.log(`⚠️ Error parsing task ${key}:`, parseError);
        }
      }
    });
    
    if (pendingTasks.length === 0) {
      console.log('✅ No pending async tasks found');
    } else {
      console.log(`📊 Found ${pendingTasks.length} pending async tasks:`);
      pendingTasks.forEach((task, index) => {
        console.log(`${index + 1}. Task ID: ${task.taskId}`);
        console.log(`   Page ID: ${task.pageId}`);
        console.log(`   Started: ${task.timestamp}`);
        console.log(`   Status: ${task.status}`);
        console.log('   ---');
      });
    }
    
    return pendingTasks;
    
  } catch (error) {
    console.error('❌ Error listing async tasks:', error);
    return [];
  }
}

// Quick test menu function
function runTestMenu() {
  console.log('🧪 TEST MENU - Choose your test:');
  console.log('0. debugChunkTest() - Simple debug test for chunk processing');
  console.log('1. testContentCleaning() - Test content filtering and issue logging');
  console.log('2. simulateFullWorkflow() - Full simulation with Zapier callbacks');
  console.log('3. simulateNotionWebhook() - Simulate Notion webhook (no wait)');
  console.log('4. testNotionWebhookWithWait() - Test with real Zapier (30s timeout)');
  console.log('5. testNotionWebhookInfiniteWait() - Test with INFINITE WAIT (recommended)');
  console.log('6. testZapierCallback() - Test single Zapier callback');
  console.log('7. testAdvancedSummarizer() - Original test with direct LLM');
  console.log('8. testActiveLLM() - Test current LLM configuration');
  console.log('9. listPendingAsyncTasks() - Check pending Zapier tasks');
  console.log('10. waitForSpecificTask(taskId) - Wait for specific task');
  console.log('');
  console.log('🎯 RECOMMENDED FOR SLOW ZAPIER:');
  console.log('testNotionWebhookInfiniteWait() // Will wait forever until Zapier responds');
  console.log('');
  console.log('🔄 For existing tasks:');
  console.log('1. listPendingAsyncTasks() // See what tasks are pending');
  console.log('2. waitForSpecificTask("task-id-here") // Wait for specific task');
  console.log('');
  console.log('Other testing order:');
  console.log('1. debugChunkTest() // Basic functionality');
  console.log('2. testContentCleaning() // Content filtering');
  console.log('3. testNotionWebhookInfiniteWait() // Real Zapier with infinite wait');
}

// Enhanced test function with comprehensive checks
function quickTest() {
  console.log('🚀 Quick Test Starting...');
  console.log('Active LLM:', ACTIVE_LLM.toUpperCase());
  
  // Test API key availability
  const config = LLM_CONFIG[ACTIVE_LLM];
  const apiKey = PropertiesService.getScriptProperties().getProperty(config.apiKeyName || config.urlPropertyName);
  
  if (apiKey) {
    console.log('✅ API key/URL found for', ACTIVE_LLM.toUpperCase());
  } else {
    console.log('❌ No API key/URL found for', config.apiKeyName || config.urlPropertyName);
  }
  
  // Test Notion API key
  const notionKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (notionKey) {
    console.log('✅ Notion API key found');
  } else {
    console.log('❌ No Notion API key found');
  }
  
  // Test file operations
  console.log('🔍 Testing file operations...');
  const testContent = 'Test content for file operations';
  const testFileName = 'test_file_ops.txt';
  
  try {
    const file = saveToGoogleDrive(testContent, testFileName);
    console.log('✅ File save test successful:', file.getName());
    
    // Test file existence check
    const existsCheck = checkFileExists(testFileName);
    if (existsCheck.exists) {
      console.log('✅ File existence check successful');
    } else {
      console.log('❌ File existence check failed');
    }
    
    // Clean up test file
    file.setTrashed(true);
    console.log('🗑️ Test file cleaned up');
    
  } catch (error) {
    console.error('❌ File operations error:', error);
  }
  
  // Test basic prompt only if both API keys exist
  if (apiKey && notionKey) {
    const testPrompt = "Hello, this is a test. Please respond with 'API working correctly'.";
    
    const response = callLLM(testPrompt);
    if (response) {
      console.log('✅ LLM Response:', response.substring(0, 100) + '...');
    } else {
      console.log('❌ No response from LLM');
    }
  } else {
    console.log('⚠️ Skipping LLM test - missing API keys');
  }
}

// ==================== SIMULATION FUNCTIONS ====================

// Simulate webhook POST request with artificial values
function simulateWebhookCall() {
  console.log('🎭 Simulating Webhook Call...');
  
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  // Create mock webhook request (FIRST CALL from Notion - original format)
  const mockRequest = {
    postData: {
      contents: JSON.stringify({
        data: {
          id: '2963f0b3-b6ab-81c4-afb7-f2f45d303302'
        },
        source: 'notion',
        type: 'automation'
      })
    }
  };
  
  console.log('📝 Mock request created');
  console.log('🚀 Calling doPost with mock data...');
  
  try {
    const response = doPost(mockRequest);
    const result = JSON.parse(response.getContent());
    
    console.log('✅ Webhook simulation complete!');
    console.log('📊 Response:', result);
    
    // Save debug logs
    if (DEBUG_LOGS.length > 0) {
      const debugFileName = `simulation_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      try {
        const debugFile = saveToGoogleDrive(DEBUG_LOGS.join('\n'), debugFileName);
        console.log('🔍 Debug log saved:', debugFile.getUrl());
      } catch (debugError) {
        console.error('Error saving debug log:', debugError);
      }
    }
    
  } catch (error) {
    console.error('❌ Simulation error:', error);
    
    // Save error logs
    if (DEBUG_LOGS.length > 0) {
      const errorFileName = `simulation_error_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const errorContent = `Simulation Error:${error.toString()}\nStack Trace:${error.stack || 'No stack trace'}\nDebug Logs:${DEBUG_LOGS.join('\n')}`;
      try {
        const errorFile = saveToGoogleDrive(errorContent, errorFileName);
        console.log('🔍 Error log saved:', errorFile.getUrl());
      } catch (saveError) {
        console.error('Error saving error log:', saveError);
      }
    }
  }
}

// Test XML tag extraction with real content
function testXMLTagExtraction() {
  console.log('🧪 Testing XML tag extraction...');
  
  // Use the REAL content from the latest log (with escaped newlines)
  const testContent = `<pageId>2963f0b3-b6ab-81c4-afb7-f2f45d303302</pageId><taskId>1761354407089_8mkquj3c5pi</taskId><ItemId>2963f0b3-b6ab-81c4-afb7-f2f45d303302_main</ItemId><rawFileName>raw_2963f0b3-b6ab-81c4-afb7-f2f45d303302_main_2025-10-25T01-06-39-649Z.txt</rawFileName><rawFileId>1wChLtx1ytS7iwKBna8Pfr1XizILWOJxE</rawFileId><contentType>main_page</contentType><contentId>2963f0b3-b6ab-81c4-afb7-f2f45d303302_main</contentId><result># 🧩 Executive Check-in Summary\\n\\n### 🗓️ Key Dates (Overall)\\n- Key milestone deliverables achieved, enabling testing towards hypotheses.\\n\\n---\\n\\n## 🎮 Overall Game Team  \\n**Summary:** The team successfully met major milestones, particularly in raid content production, enhancing confidence in capacity despite some incurred debt. Team morale remains high with a focus on consistent content delivery.  \\n\\n### ✨ Opportunities  \\n- Improved content production enhances our confidence in overall capacity, positively impacting timelines and resource allocations.\\n- Positive signals from Art validation tests indicate alignment with player expectations, crucial for future marketing strategies.  \\n\\n### 🧱 Obstacles  \\n- Capacity limitations have created financial pressures, resulting in incurred debt affecting planning.  \\n- Uncertainty around the Open Beta decision due to pending feedback from playtests could delay timelines.\\n\\n### 🎯 This Milestone's Expectations  \\n- Measurable outcomes include a clear understanding of playtest feedback to inform potential upgrade to Open Beta.\\n- Emphasis on improving content velocity to maintain daily testing and iterative development.\\n\\n---\\n\\n## 🧰 Central Tech / Engineering  \\n**Summary:** Technical progress is steady with continuous cross-team collaboration, but the team faces capacity challenges that need addressing.\\n\\n### ✨ Opportunities  \\n- Enhanced collaboration between engineering and art teams to streamline production workflows.\\n\\n### 🧱 Obstacles  \\n- Engineering and Art capacity concerns impacting overall project efficiency and timelines.\\n\\n### 🎯 Expectations  \\n- Expectations include meeting capacity standards to support sustained content development and testing without delay.\\n\\n---\\n\\n## 🎨 EMV / Publishing / Art & Marketing Validation  \\n**Summary:** Art validation tests have yielded positive feedback, crucial for aligning the creative direction with target audience expectations.\\n\\n### ✨ Opportunities  \\n- Art validation signals strong alignment with audience preferences; this can leverage marketing strategies for upcoming releases.\\n\\n### 🧱 Obstacles  \\n- Potential misalignment in resource allocation could delay critical approval processes for artwork revisions.\\n\\n### 🎯 Expectations  \\n- Continued positive validation outcomes are expected to guide future creative direction and marketing initiatives effectively.\\n\\n---\\n\\n## 📈 Narrative & Creative Direction  \\n**Summary:** The narrative direction is coherent and aligns with artistic elements, showing improvements in tone and audience engagement.\\n\\n### ✨ Opportunities  \\n- Strengthening the connection between narrative and art could enhance player immersion, driving engagement.\\n\\n### 🧱 Obstacles  \\n- Risks of narrative inconsistencies remain if cross-departmental communications falter.\\n\\n### 🎯 Expectations  \\n- Expectations include refining narrative alignment in upcoming iterations based on feedback from both internal tests and external audiences.\\n\\n---\\n\\n## 🧩 Next Steps  \\n- Address capacity limitations to mitigate further debt increase.\\n- Await playtest feedback before deciding on Open Beta strategy.\\n- Sustain the momentum of raid content production while enhancing daily testing cadence.</result>`;
  
  console.log('📋 Testing extraction with sample content...');
  const extracted = extractXMLTagsFromContent(testContent);
  
  console.log('📊 Extraction results:');
  console.log('Page ID:', extracted.pageId);
  console.log('Task ID:', extracted.taskId);  
  console.log('Item ID:', extracted.itemId);
  console.log('Content Type:', extracted.contentType);
  console.log('Content ID:', extracted.contentId);
  console.log('Raw File Name:', extracted.rawFileName);
  console.log('Raw File ID:', extracted.rawFileId);
  console.log('Result found:', !!extracted.result);
  console.log('Result length:', extracted.result ? extracted.result.length : 0);
  
  if (extracted.result) {
    console.log('Result preview:', extracted.result.substring(0, 200) + '...');
    console.log('Result ends with:', extracted.result.substring(extracted.result.length - 50));
  } else {
    console.log('❌ NO RESULT EXTRACTED - This is the problem!');
  }
  
  // Test if we can find the word "Executive" in the content (should be in result)
  const hasExecutive = testContent.includes('Executive');
  console.log('Content contains "Executive":', hasExecutive);
  
  // Try manual regex test
  const manualResultMatch = testContent.match(/<result>([\s\S]*?)$/i);
  console.log('Manual regex match found:', !!manualResultMatch);
  if (manualResultMatch) {
    console.log('Manual match length:', manualResultMatch[1].length);
    console.log('Manual match preview:', manualResultMatch[1].substring(0, 200) + '...');
  }
  
  return extracted;
}

// Test detailed Notion content extraction
function testNotionContentExtraction() {
  console.log('🧪 Testing detailed Notion content extraction...');
  
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  const pageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  
  try {
    console.log('📄 Fetching page details...');
    const pageDetails = fetchNotionPage(pageId);
    console.log('Page Title:', pageDetails.title);
    
    console.log('📝 Fetching page content with children...');
    const content = fetchNotionPageContent(pageId);
    
    console.log('✅ Content extraction completed!');
    console.log('📊 Content length:', content.length);
    console.log('📋 Content preview (first 500 chars):');
    console.log(content.substring(0, 500) + '...');
    
    // Save full content for analysis
    const contentFileName = `notion_content_detailed_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    try {
      const contentFile = saveToGoogleDrive(content, contentFileName);
      console.log('📁 Full content saved:', contentFile.getName());
    } catch (saveError) {
      console.error('Error saving content:', saveError);
    }
    
    // Check for specific patterns we expect
    const hasKeyTakeaways = content.includes('Key takeaways');
    const hasTestsUpcoming = content.includes('Tests upcoming');
    const hasSuperusers = content.includes('Superusers');
    const hasPTC = content.includes('PTC');
    
    console.log('🔍 Content analysis:');
    console.log('- Has "Key takeaways":', hasKeyTakeaways);
    console.log('- Has "Tests upcoming":', hasTestsUpcoming);
    console.log('- Has "Superusers":', hasSuperusers);
    console.log('- Has "PTC":', hasPTC);
    
    return {
      pageDetails: pageDetails,
      content: content,
      contentLength: content.length,
      analysis: {
        hasKeyTakeaways,
        hasTestsUpcoming,
        hasSuperusers,
        hasPTC
      }
    };
    
  } catch (error) {
    console.error('❌ Notion extraction test error:', error);
    
    // Save error logs
    if (DEBUG_LOGS.length > 0) {
      const errorFileName = `test_notion_extraction_error_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const errorContent = `Notion Extraction Test Error: ${error.toString()}\nStack Trace: ${error.stack || 'No stack trace'}\nDebug Logs: ${DEBUG_LOGS.join('\n')}`;
      try {
        const errorFile = saveToGoogleDrive(errorContent, errorFileName);
        console.log('🔍 Error log saved:', errorFile.getName());
      } catch (saveError) {
        console.error('Error saving error log:', saveError);
      }
    }
    
    throw error;
  }
}

// Test complete page processing from Notion extraction to LLM calls
function testCompletePageProcessing() {
  console.log('🧪 Testing complete page processing...');
  
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  const pageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  
  try {
    console.log('🚀 Starting processNotionPage...');
    const result = processNotionPage(pageId);
    
    console.log('✅ Page processing initiated!');
    console.log('📊 Result:', result);
    
    // Save debug logs
    if (DEBUG_LOGS.length > 0) {
      const debugFileName = `test_complete_processing_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      try {
        const debugFile = saveToGoogleDrive(DEBUG_LOGS.join('\n'), debugFileName);
        console.log('🔍 Debug log saved:', debugFile.getName());
      } catch (debugError) {
        console.error('Error saving debug log:', debugError);
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test error:', error);
    
    // Save error logs
    if (DEBUG_LOGS.length > 0) {
      const errorFileName = `test_complete_processing_error_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const errorContent = `Test Error: ${error.toString()}\nStack Trace: ${error.stack || 'No stack trace'}\nDebug Logs: ${DEBUG_LOGS.join('\n')}`;
      try {
        const errorFile = saveToGoogleDrive(errorContent, errorFileName);
        console.log('🔍 Error log saved:', errorFile.getName());
      } catch (saveError) {
        console.error('Error saving error log:', saveError);
      }
    }
    
    throw error;
  }
}

// Simulate GET request with artificial values
function simulateGetCall() {
  console.log('🎭 Simulating GET Call...');
  
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  // Create mock GET request
  const mockRequest = {
    parameter: {
      pageId: '28e3f0b3-b6ab-80f4-8680-e89decac5b1f',
      debug: 'true'    },
    queryString: 'pageId=28e3f0b3-b6ab-80f4-8680-e89decac5b1f&debug=true'  };
  
  console.log('📝 Mock GET request created');
  console.log('🚀 Calling doGet with mock data...');
  
  try {
    const response = doGet(mockRequest);
    const result = JSON.parse(response.getContent());
    
    console.log('✅ GET simulation complete!');
    console.log('📊 Response:', result);
    
  } catch (error) {
    console.error('❌ GET simulation error:', error);
  }
}

// Test individual functions with mock data
function testIndividualFunctions() {
  console.log('🧪 Testing Individual Functions...');
  
  DEBUG_MODE = true;
  DEBUG_LOGS = [];
  
  try {
    // Test page ID extraction
    console.log('1️⃣ Testing page ID extraction...');
    const mockWebhookData = {
      data: {
        id: '28e3f0b3-b6ab-80f4-8680-e89decac5b1f'      }
    };
    const extractedId = extractPageIdFromRequest(mockWebhookData);
    console.log('✅ Extracted page ID:', extractedId);
    
    // Test URL type detection
    console.log('2️⃣ Testing URL type detection...');
    const testUrls = [
      'https://docs.google.com/document/d/1abc123/edit',
      'https://docs.google.com/spreadsheets/d/1xyz789/edit',
      'https://notion.so/some-page-id',
      'https://example.com/invalid'    ];
    
    testUrls.forEach(url => {
      const urlType = detectUrlType(url);
      console.log(`   URL: ${url} -> Type: ${urlType ? urlType.type : 'null'}`);
    });
    
    // Test content chunking
    console.log('3️⃣ Testing content chunking...');
    const longContent = 'This is a test. '.repeat(2000); // Create ~30KB content
    const chunks = chunkContent(longContent, 5000);
    console.log(`✅ Split ${longContent.length} chars into ${chunks.length} chunks`);
    
    // Test file operations
    console.log('4️⃣ Testing file operations...');
    const testContent = 'Mock content for testing file operationsLine 2Line 3';
    const testFile = saveToGoogleDrive(testContent, 'mock_test_file.txt');
    console.log('✅ File saved:', testFile.getName());
    
    const fileCheck = checkFileExists('mock_test_file.txt');
    console.log('✅ File exists check:', fileCheck.exists);
    
    // Clean up
    testFile.setTrashed(true);
    console.log('🗑️ Test file cleaned up');
    
    // Test DocumentStructure
    console.log('5️⃣ Testing DocumentStructure...');
    const doc = new DocumentStructure('test-page-id', 'Test Page Title');
    doc.mainContent = 'This is test content with meeting keywords: meeting, transcript, attendees, action items';
    doc.detectMeetingTranscription();
    doc.addUnsupportedBlock('transcription', 'block-id-123');
    doc.addExternalLink('google_doc', 'https://docs.google.com/document/d/123', 'External content', 'External summary');
    
    console.log('✅ Document structure created:');
    console.log(`   - Is Meeting: ${doc.isMeetingTranscription}`);
    console.log(`   - Unsupported Blocks: ${doc.unsupportedBlocks.length}`);
    console.log(`   - External Links: ${doc.externalLinks.length}`);
    
    console.log('✅ All individual function tests completed!');
    
  } catch (error) {
    console.error('❌ Individual function test error:', error);
  }
}

// Test full workflow
function testFullWorkflow() {
  debugLog('🧪 Starting full workflow test');
  
  const testPageId = '199488a4ab3b80b48764afe28cd073c1';
  
  debugLog('📄 Processing test page', { pageId: testPageId });
  
  try {
    processNotionPage(testPageId);
    debugLog('✅ Full workflow test completed');
  } catch (error) {
    debugLog('❌ Full workflow test failed', { error: error.toString() });
  }
}

// Test function to simulate Zapier webhook
function testSimulateZapierWebhook() {
  debugLog('🧪 Simulating Zapier webhook');
  
  const testResult = `# Test Summary from Zapier LLM

## Key Points
- This is a test response from Zapier webhook simulation
- Successfully processed content through external LLM
- Webhook callback mechanism working correctly

## Technical Details
- Response generated at: ${new Date().toISOString()}
- Simulated processing time: 45 seconds
- Status: Success

## Next Steps
- Verify integration with main workflow
- Test with real Notion pages
- Monitor performance metrics`;

  const testTaskId = `test_${Date.now()}`;
  
  const mockRequest = {
    taskId: testTaskId,
    result: testResult,
    metadata: {
      model: 'gpt-4o',
      tokens: 150,
      processingTime: 45
    }
  };
  
  debugLog('📤 Simulating POST request to doPost handler');
  
  // Simulate the webhook call
  const response = doPost_HandleZapierLLMResult(mockRequest);
  
  debugLog('✅ Zapier webhook simulation completed', { 
    taskId: testTaskId,
    response: response.getContent()
  });
  
  // Test retrieval
  debugLog('🔍 Testing result retrieval');
  const retrievedResult = checkForZapierResult(testTaskId);
  
  if (retrievedResult) {
    debugLog('✅ Result successfully retrieved', { 
      resultLength: retrievedResult.length 
    });
  } else {
    debugLog('❌ Failed to retrieve result');
  }
  
  return testTaskId;
}

// NEW: Test function with headers (content tracking)
function testZapierWebhookWithHeaders() {
  debugLog('🧪 Testing Zapier webhook with content tracking headers');
  
  const testResult = `# Comprehensive Document Analysis

## Executive Summary
This document contains strategic planning information and technical specifications for our Q4 initiatives. The content demonstrates strong alignment between technical implementation and business objectives.

## Key Findings
- **Technical Progress**: Infrastructure updates are 85% complete
- **Business Impact**: Expected 40% improvement in user engagement
- **Timeline**: On track for Q4 delivery
- **Resource Allocation**: Current staffing levels are adequate

## Recommendations
1. Accelerate testing phase for early feedback
2. Prepare rollback strategy for risk mitigation
3. Schedule stakeholder review meeting for next week

## Technical Details
- Database optimization: Completed
- API endpoints: 12/15 implemented
- Frontend integration: In progress
- Security audit: Scheduled for next week`;

  const testTaskId = `test_${Date.now()}`;
  const testPageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  const testContentId = `${testPageId}_main`;
  const testRawFileName = `raw_${testPageId}_main_2025-10-24T18-46-32-453Z.txt`;
  
  // Simulate request with headers (like what Zapier would send)
  const mockRequestWithHeaders = {
    taskId: testTaskId,
    result: testResult,
    
    // Headers that Zapier sends
    contentid: testContentId,
    contenttype: 'main_page',
    rawfileid: '1SiLuICrqw6f-Ua0p7rx_z30fbLhQEMNX',
    rawfilename: testRawFileName,
    itemid: testContentId,
    pageid: testPageId,
    
    metadata: {
      model: 'gpt-4o',
      tokens: 250,
      processingTime: 60
    }
  };
  
  debugLog('📤 Simulating POST request with content tracking headers');
  debugLog('📋 Mock request structure', {
    taskId: testTaskId,
    contentType: 'main_page',
    contentId: testContentId,
    pageId: testPageId,
    rawFileName: testRawFileName,
    resultLength: testResult.length
  });
  
  // Simulate the webhook call
  const response = doPost_HandleZapierLLMResult(mockRequestWithHeaders);
  const responseData = JSON.parse(response.getContent());
  
  debugLog('✅ Zapier webhook with headers completed', { 
    taskId: testTaskId,
    processedFile: responseData.processedResultFile,
    contentType: responseData.contentType,
    contentId: responseData.contentId,
    response: responseData
  });
  
  return {
    taskId: testTaskId,
    responseData: responseData,
    testSuccess: responseData.status === 'success'
  };
}

// Test function for sub-block processing
function testZapierWebhookSubBlock() {
  debugLog('🧪 Testing Zapier webhook for sub-block content');
  
  const testResult = `# External Document Analysis

## Document Overview
This Google Document contains supplementary information that provides additional context to the main Notion page. The content focuses on implementation details and technical specifications.

## Key Content
- **Document Type**: Technical specification
- **Last Updated**: Recent updates indicate active development
- **Dependencies**: Links to main project requirements
- **Status**: Ready for integration

## Summary
This external document successfully complements the main page content and should be included in the final analysis.`;

  const testTaskId = `test_sub_${Date.now()}`;
  const testPageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  const testContentId = `${testPageId}_sub_1`;
  const testRawFileName = `raw_${testPageId}_sub_1_2025-10-24T18-46-32-453Z.txt`;
  
  // Simulate sub-block request with headers
  const mockSubBlockRequest = {
    taskId: testTaskId,
    result: testResult,
    
    // Headers for sub-block
    contentid: testContentId,
    contenttype: 'sub_block',
    rawfileid: '1XYZ123abc-SubBlock-FileId',
    rawfilename: testRawFileName,
    itemid: testContentId,
    pageid: testPageId,
    
    metadata: {
      model: 'gpt-4o',
      tokens: 180,
      processingTime: 45,
      sourceType: 'google_doc',
      sourceUrl: 'https://docs.google.com/document/d/1XYZ123/edit'
    }
  };
  
  debugLog('📤 Simulating sub-block POST request');
  debugLog('📋 Sub-block request structure', {
    taskId: testTaskId,
    contentType: 'sub_block',
    contentId: testContentId,
    pageId: testPageId,
    rawFileName: testRawFileName,
    resultLength: testResult.length
  });
  
  // Simulate the webhook call
  const response = doPost_HandleZapierLLMResult(mockSubBlockRequest);
  const responseData = JSON.parse(response.getContent());
  
  debugLog('✅ Sub-block webhook completed', { 
    taskId: testTaskId,
    processedFile: responseData.processedResultFile,
    contentType: responseData.contentType,
    contentId: responseData.contentId,
    response: responseData
  });
  
  return {
    taskId: testTaskId,
    responseData: responseData,
    testSuccess: responseData.status === 'success'
  };
}

// Simulate Zapier callback (if needed)
function simulateZapierCallback(sessionId, chunkNumber, totalChunks, content) {
  console.log('🔄 Simulating Zapier callback...');
  
  const mockPayload = {
    sessionId: sessionId,
    chunkNumber: chunkNumber,
    totalChunks: totalChunks,
    content: content,
    timestamp: new Date().toISOString()
  };
  
  console.log('📦 Mock payload created:', {
    sessionId: sessionId,
    chunkNumber: chunkNumber,
    totalChunks: totalChunks,
    contentLength: content.length
  });
  
  // Simulate processing
  return {
    success: true,
    processed: true,
    sessionId: sessionId,
    chunkNumber: chunkNumber
  };
}

// NEW: Test doPost with exact simulation of Zapier callback
function testDoPostWithFullSimulation() {
  console.log('🧪 Testing doPost with full Zapier simulation');
  console.log('================================================');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testPageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  const testTaskId = `test_task_${Date.now()}`;
  
  // Generate random test result content
  const randomTexts = [
    "This comprehensive analysis reveals significant progress in our strategic initiatives. The team has demonstrated exceptional performance in delivering key milestones while maintaining high quality standards.",
    "Our evaluation of the current state indicates positive momentum across all major objectives. Technical implementation has exceeded expectations with robust solutions deployed successfully.",
    "The document review highlights critical achievements in process optimization and system integration. Stakeholder engagement remains strong with clear alignment on future direction.",
    "Analysis of recent developments shows substantial advancement in core competencies. The framework established provides solid foundation for scaling operations efficiently.",
    "Executive assessment confirms strategic objectives are being met with measurable outcomes. Innovation initiatives have yielded promising results worthy of continued investment."
  ];
  
  const testResult = randomTexts[Math.floor(Math.random() * randomTexts.length)] + `\n\nProcessed at: ${new Date().toISOString()}\nTest execution ID: ${testTaskId}`;
  
  console.log('📋 Test Configuration:');
  console.log('- Page ID:', testPageId);
  console.log('- Task ID:', testTaskId);
  console.log('- Result length:', testResult.length);
  console.log('- Timestamp:', timestamp);
  
  // Create the exact structure that Zapier would send
  const mockEvent = {
    // Parameters/headers that come in the URL
    parameter: {
      contentid: `${testPageId}_main`,
      contenttype: 'main_page',
      rawfileid: '1SiLuICrqw6f-Ua0p7rx_z30fbLhQEMNX',
      rawfilename: `raw_${testPageId}_main_${timestamp}.txt`,
      itemid: `${testPageId}_main`,
      taskid: testTaskId,
      pageid: testPageId
    },
    
    // POST body content
    postData: {
      type: 'application/json',
      contents: JSON.stringify({
        taskId: testTaskId,
        result: testResult,
        
        // Include headers in body too (as Zapier might send both ways)
        contentid: `${testPageId}_main`,
        contenttype: 'main_page',
        rawfileid: '1SiLuICrqw6f-Ua0p7rx_z30fbLhQEMNX',
        rawfilename: `raw_${testPageId}_main_${timestamp}.txt`,
        itemid: `${testPageId}_main`,
        pageid: testPageId,
        
        // Additional metadata
        metadata: {
          pageId: testPageId,
          pageTitle: "Test Page Title",
          model: 'gpt-4o',
          tokens: 350,
          processingTime: 2500,
          timestamp: new Date().toISOString()
        }
      })
    }
  };
  
  console.log('📤 Calling doPost with mock event...');
  console.log('Mock event structure:', JSON.stringify(mockEvent, null, 2));
  
  try {
    // Call the actual doPost function
    const response = doPost(mockEvent);
    
    // Parse the response
    const responseContent = response.getContent();
    const responseData = JSON.parse(responseContent);
    
    console.log('✅ doPost executed successfully!');
    console.log('📊 Response:', JSON.stringify(responseData, null, 2));
    
    // Check what happened
    if (responseData.status === 'success') {
      console.log('✅ SUCCESS - Processing completed');
      console.log('- Processed file:', responseData.processedResultFile);
      console.log('- Content type:', responseData.contentType);
      console.log('- Content ID:', responseData.contentId);
      
      // Try to read the created files
      try {
        const files = DriveApp.searchFiles(`title contains "${testPageId}"`);
        console.log('\n📁 Files created for this page ID:');
        while (files.hasNext()) {
          const file = files.next();
          console.log(`- ${file.getName()} (${file.getId()})`);
        }
      } catch (e) {
        console.log('Could not list files:', e.toString());
      }
      
    } else {
      console.log('❌ ERROR - Processing failed');
      console.log('- Error:', responseData.error);
      console.log('- Message:', responseData.message);
    }
    
    return {
      success: true,
      response: responseData,
      testTaskId: testTaskId
    };
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.toString());
    console.error('Stack trace:', error.stack);
    
    return {
      success: false,
      error: error.toString(),
      stack: error.stack
    };
  }
}

// Test doPost for sub-block
function testDoPostSubBlock() {
  console.log('🧪 Testing doPost with SUB-BLOCK simulation');
  console.log('============================================');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testPageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  const testTaskId = `test_sub_task_${Date.now()}`;
  const subBlockIndex = 1;
  
  // Sub-block test result
  const testResult = `# External Document Summary

This Google Document provides detailed implementation specifications that complement the main page content. 
Key technical details have been extracted and analyzed for integration with the primary documentation.

## Key Points
- Implementation timeline aligns with project milestones
- Technical dependencies are clearly documented
- Resource allocation matches current capacity

Generated at: ${new Date().toISOString()}`;
  
  console.log('📋 Sub-block Test Configuration:');
  console.log('- Page ID:', testPageId);
  console.log('- Sub-block ID:', `${testPageId}_sub_${subBlockIndex}`);
  console.log('- Task ID:', testTaskId);
  
  // Create sub-block event
  const mockEvent = {
    parameter: {
      contentid: `${testPageId}_sub_${subBlockIndex}`,
      contenttype: 'sub_block',
      rawfileid: '1XYZ123abc-SubBlock-FileId',
      rawfilename: `raw_${testPageId}_sub_${subBlockIndex}_${timestamp}.txt`,
      itemid: `${testPageId}_sub_${subBlockIndex}`,
      taskid: testTaskId,
      pageid: testPageId
    },
    
    postData: {
      type: 'application/json',
      contents: JSON.stringify({
        taskId: testTaskId,
        result: testResult,
        
        // Headers in body
        contentid: `${testPageId}_sub_${subBlockIndex}`,
        contenttype: 'sub_block',
        rawfileid: '1XYZ123abc-SubBlock-FileId',
        rawfilename: `raw_${testPageId}_sub_${subBlockIndex}_${timestamp}.txt`,
        itemid: `${testPageId}_sub_${subBlockIndex}`,
        pageid: testPageId,
        
        metadata: {
          pageId: testPageId,
          sourceType: 'google_doc',
          sourceUrl: 'https://docs.google.com/document/d/1XYZ123/edit',
          model: 'gpt-4o',
          tokens: 200
        }
      })
    }
  };
  
  console.log('📤 Calling doPost for sub-block...');
  
  try {
    const response = doPost(mockEvent);
    const responseData = JSON.parse(response.getContent());
    
    console.log('✅ Sub-block doPost executed!');
    console.log('📊 Response:', JSON.stringify(responseData, null, 2));
    
    return {
      success: true,
      response: responseData,
      testTaskId: testTaskId
    };
    
  } catch (error) {
    console.error('❌ Sub-block test failed:', error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Test the complete flow: main + sub-block to trigger final processing
function testCompletePageProcessingFlow() {
  console.log('🎯 Testing COMPLETE page processing flow');
  console.log('========================================');
  console.log('This will simulate main page + sub-block to trigger final webhook');
  
  const testPageId = '2963f0b3-b6ab-81c4-afb7-f2f45d303302';
  
  // Step 1: Initialize page status control manually
  console.log('\n📝 Step 1: Initializing page status control...');
  const mockIndex = {
    main: {
      id: `${testPageId}_main`,
      contentId: `${testPageId}_main`,
      title: 'Test Page Title'
    },
    subBlocks: [
      {
        id: `${testPageId}_sub_1`,
        contentId: `${testPageId}_sub_1`,
        sourceType: 'google_doc',
        url: 'https://docs.google.com/document/d/1XYZ123/edit',
        title: 'External Google Doc'
      }
    ],
    totalItems: 2
  };
  
  const statusControl = initializePageStatusControl(testPageId, mockIndex);
  console.log('✅ Status control initialized');
  
  // Step 2: Process main page
  console.log('\n📝 Step 2: Processing main page...');
  const mainResult = testDoPostWithFullSimulation();
  
  if (!mainResult.success) {
    console.error('❌ Main page processing failed');
    return;
  }
  
  // Wait a bit
  console.log('\n⏳ Waiting 2 seconds...');
  Utilities.sleep(2000);
  
  // Step 3: Process sub-block (this should trigger final processing)
  console.log('\n📝 Step 3: Processing sub-block (should trigger final processing)...');
  const subResult = testDoPostSubBlock();
  
  if (!subResult.success) {
    console.error('❌ Sub-block processing failed');
    return;
  }
  
  console.log('\n✅ Complete flow test finished!');
  console.log('Check for:');
  console.log('- page_status_*.json file updated');
  console.log('- final_summary_*.md file created');
  console.log('- Webhook sent (if enabled)');
  
  // Check final status
  const finalStatus = checkPageCompletionStatus(testPageId);
  console.log('\n📊 Final Status:', finalStatus);
}

// Quick test menu update
function testMenu() {
  console.log('🧪 DOPOST TEST MENU');
  console.log('===================');
  console.log('');
  console.log('1. testDoPostWithFullSimulation() - Test main page doPost');
  console.log('2. testDoPostSubBlock() - Test sub-block doPost');
  console.log('3. testCompletePageProcessingFlow() - Test full flow (main + sub → webhook)');
  console.log('');
  console.log('🎯 RECOMMENDED TEST SEQUENCE:');
  console.log('testCompletePageProcessingFlow() // This tests everything!');
  console.log('');
  console.log('📋 Individual tests:');
  console.log('testDoPostWithFullSimulation() // Just main page');
  console.log('testDoPostSubBlock() // Just sub-block');
}