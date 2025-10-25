// ==================== PROPERTIES STORAGE SYSTEM ====================
// Simple, reliable storage using only Properties Service
// 500KB per property, automatic chunking, webapp-friendly

// ==================== CORE STORAGE FUNCTIONS ====================

// Save data to Properties Service with automatic chunking
function saveToStorage(path, data, metadata = {}) {
  debugLog('💾 Saving to Properties Storage', {
    path: path,
    dataSize: typeof data === 'string' ? data.length : JSON.stringify(data).length
  });
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const maxChunkSize = STORAGE_CONFIG.maxChunkSize;
    
    // Auto-cleanup if needed
    if (STORAGE_CONFIG.autoCleanup) {
      autoCleanupIfNeeded();
    }
    
    if (content.length <= maxChunkSize) {
      // Single property - no chunking needed
      const propertyData = {
        content: content,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          size: content.length,
          chunked: false
        }
      };
      
      scriptProperties.setProperty(`STORAGE_${path}`, JSON.stringify(propertyData));
      
      debugLog('✅ Properties save successful (single)', {
        path: path,
        size: content.length
      });
      
      return {
        success: true,
        path: path,
        size: content.length,
        chunked: false
      };
      
    } else {
      // Multiple chunks needed
      const chunks = [];
      for (let i = 0; i < content.length; i += maxChunkSize) {
        chunks.push(content.substring(i, i + maxChunkSize));
      }
      
      // Save each chunk
      chunks.forEach((chunk, index) => {
        scriptProperties.setProperty(`STORAGE_${path}_CHUNK_${index}`, chunk);
      });
      
      // Save metadata
      const metadataObj = {
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          size: content.length,
          chunked: true,
          chunkCount: chunks.length
        }
      };
      
      scriptProperties.setProperty(`STORAGE_${path}_META`, JSON.stringify(metadataObj));
      
      debugLog('✅ Properties save successful (chunked)', {
        path: path,
        size: content.length,
        chunks: chunks.length
      });
      
      return {
        success: true,
        path: path,
        size: content.length,
        chunked: true,
        chunkCount: chunks.length
      };
    }
    
  } catch (error) {
    debugLog('❌ Properties save error', {
      path: path,
      error: error.toString()
    });
    return { success: false, error: error.toString() };
  }
}

// Load data from Properties Service
function loadFromStorage(path) {
  debugLog('📖 Loading from Properties Storage', { path: path });
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    
    // Try single property first
    const singleData = scriptProperties.getProperty(`STORAGE_${path}`);
    if (singleData) {
      const parsed = JSON.parse(singleData);
      
      debugLog('✅ Properties load successful (single)', {
        path: path,
        size: parsed.metadata?.size || 0
      });
      
      return {
        content: parsed.content,
        metadata: parsed.metadata || {}
      };
    }
    
    // Try chunked data
    const metaData = scriptProperties.getProperty(`STORAGE_${path}_META`);
    if (metaData) {
      const meta = JSON.parse(metaData);
      const chunkCount = meta.metadata.chunkCount;
      
      let reconstructedContent = '';
      for (let i = 0; i < chunkCount; i++) {
        const chunk = scriptProperties.getProperty(`STORAGE_${path}_CHUNK_${i}`);
        if (chunk) {
          reconstructedContent += chunk;
        } else {
          debugLog('⚠️ Missing chunk', { path: path, chunkIndex: i });
        }
      }
      
      debugLog('✅ Properties load successful (chunked)', {
        path: path,
        size: reconstructedContent.length,
        chunks: chunkCount
      });
      
      return {
        content: reconstructedContent,
        metadata: meta.metadata || {}
      };
    }
    
    debugLog('📋 Properties path not found', { path: path });
    return null;
    
  } catch (error) {
    debugLog('❌ Properties load error', {
      path: path,
      error: error.toString()
    });
    return null;
  }
}

// Delete data from Properties Service
function deleteFromStorage(path) {
  debugLog('🗑️ Deleting from Properties Storage', { path: path });
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    
    // Delete single property
    scriptProperties.deleteProperty(`STORAGE_${path}`);
    
    // Delete chunked data if exists
    const metaData = scriptProperties.getProperty(`STORAGE_${path}_META`);
    if (metaData) {
      try {
        const meta = JSON.parse(metaData);
        const chunkCount = meta.metadata.chunkCount;
        
        // Delete all chunks
        for (let i = 0; i < chunkCount; i++) {
          scriptProperties.deleteProperty(`STORAGE_${path}_CHUNK_${i}`);
        }
        
        // Delete metadata
        scriptProperties.deleteProperty(`STORAGE_${path}_META`);
        
        debugLog('✅ Properties delete successful (chunked)', { 
          path: path,
          chunksDeleted: chunkCount
        });
        
      } catch (parseError) {
        debugLog('⚠️ Error parsing metadata during delete, deleting anyway', {
          path: path,
          error: parseError.toString()
        });
      }
    } else {
      debugLog('✅ Properties delete successful (single)', { path: path });
    }
    
    return { success: true };
    
  } catch (error) {
    debugLog('❌ Properties delete error', {
      path: path,
      error: error.toString()
    });
    return { success: false, error: error.toString() };
  }
}

// ==================== SPECIALIZED SAVE FUNCTIONS ====================

// Save raw file content (original content before LLM processing)
function saveRawFile(pageId, itemId, contentType, content) {
  const path = `${STORAGE_CONFIG.rawFilesPath}/${pageId}/${itemId}_${contentType}`;
  return saveToStorage(path, content, {
    type: 'raw_file',
    pageId: pageId,
    itemId: itemId,
    contentType: contentType
  });
}

// Save processed file content (after LLM processing)
function saveProcessedFile(pageId, itemId, contentType, content, taskId) {
  const path = `${STORAGE_CONFIG.processedFilesPath}/${pageId}/${itemId}_${contentType}`;
  return saveToStorage(path, content, {
    type: 'processed_file',
    pageId: pageId,
    itemId: itemId,
    contentType: contentType,
    taskId: taskId
  });
}

// Save status control data
function saveStatusControl(pageId, statusData) {
  const path = `${STORAGE_CONFIG.statusPath}/${pageId}`;
  return saveToStorage(path, statusData, {
    type: 'status_control',
    pageId: pageId
  });
}

// ==================== SPECIALIZED LOAD FUNCTIONS ====================

// Load raw file content
function loadRawFile(pageId, itemId, contentType) {
  const path = `${STORAGE_CONFIG.rawFilesPath}/${pageId}/${itemId}_${contentType}`;
  return loadFromStorage(path);
}

// Load processed file content
function loadProcessedFile(pageId, itemId, contentType) {
  const path = `${STORAGE_CONFIG.processedFilesPath}/${pageId}/${itemId}_${contentType}`;
  return loadFromStorage(path);
}

// Load status control data
function loadStatusControl(pageId) {
  const path = `${STORAGE_CONFIG.statusPath}/${pageId}`;
  return loadFromStorage(path);
}

// ==================== CLEANUP AND MAINTENANCE ====================

// Auto-cleanup when approaching Properties Service limits
function autoCleanupIfNeeded() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    const storageKeys = Object.keys(allProperties).filter(key => 
      key.startsWith('STORAGE_') && !key.includes('_CHUNK_') && !key.endsWith('_META')
    );
    
    if (storageKeys.length > STORAGE_CONFIG.maxEntries) {
      debugLog('🧹 Auto-cleanup triggered', { 
        currentEntries: storageKeys.length,
        maxEntries: STORAGE_CONFIG.maxEntries
      });
      
      cleanupOldStorageEntries(STORAGE_CONFIG.maxAge);
    }
    
  } catch (error) {
    debugLog('❌ Auto-cleanup error', { error: error.toString() });
  }
}

// Clean up old storage entries
function cleanupOldStorageEntries(olderThanHours = 24) {
  debugLog('🧹 Cleaning up old storage entries', { olderThanHours: olderThanHours });
  
  const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
  let cleanedCount = 0;
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    
    // Find entries to clean
    const entriesToClean = [];
    
    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('STORAGE_') && !key.includes('_CHUNK_') && !key.endsWith('_META')) {
        try {
          const data = JSON.parse(allProperties[key]);
          if (data.metadata && data.metadata.timestamp) {
            const entryTime = new Date(data.metadata.timestamp);
            if (entryTime < cutoffTime) {
              const path = key.replace('STORAGE_', '');
              entriesToClean.push(path);
            }
          }
        } catch (parseError) {
          // Invalid data, mark for cleanup
          const path = key.replace('STORAGE_', '');
          entriesToClean.push(path);
        }
      }
    });
    
    // Clean identified entries
    entriesToClean.forEach(path => {
      try {
        deleteFromStorage(path);
        cleanedCount++;
      } catch (deleteError) {
        debugLog('⚠️ Error deleting entry during cleanup', {
          path: path,
          error: deleteError.toString()
        });
      }
    });
    
  } catch (error) {
    debugLog('❌ Error during cleanup', { error: error.toString() });
  }
  
  debugLog('✅ Storage cleanup completed', { cleanedCount: cleanedCount });
  return cleanedCount;
}

// Get storage statistics
function getStorageStats() {
  debugLog('📊 Getting storage statistics');
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    
    const stats = {
      properties: {
        total: 0,
        storage: 0,
        chunks: 0,
        metadata: 0,
        other: 0
      },
      sizes: {
        total: 0,
        average: 0,
        largest: 0
      },
      entries: []
    };
    
    Object.keys(allProperties).forEach(key => {
      const value = allProperties[key];
      const size = value.length;
      
      stats.properties.total++;
      stats.sizes.total += size;
      
      if (size > stats.sizes.largest) {
        stats.sizes.largest = size;
      }
      
      if (key.startsWith('STORAGE_')) {
        if (key.includes('_CHUNK_')) {
          stats.properties.chunks++;
        } else if (key.endsWith('_META')) {
          stats.properties.metadata++;
        } else {
          stats.properties.storage++;
          
          // Parse entry info
          try {
            const data = JSON.parse(value);
            stats.entries.push({
              path: key.replace('STORAGE_', ''),
              size: data.metadata?.size || size,
              timestamp: data.metadata?.timestamp || 'unknown',
              chunked: data.metadata?.chunked || false,
              type: data.metadata?.type || 'unknown'
            });
          } catch (parseError) {
            // Skip invalid entries
          }
        }
      } else {
        stats.properties.other++;
      }
    });
    
    stats.sizes.average = stats.properties.total > 0 ? 
      Math.round(stats.sizes.total / stats.properties.total) : 0;
    
    // Sort entries by size (largest first)
    stats.entries.sort((a, b) => b.size - a.size);
    
    debugLog('✅ Storage statistics calculated', {
      totalEntries: stats.properties.storage,
      totalSize: stats.sizes.total,
      largestEntry: stats.sizes.largest
    });
    
    return stats;
    
  } catch (error) {
    debugLog('❌ Error getting storage statistics', { error: error.toString() });
    return null;
  }
}

// Clean completed page data (after final webhook sent)
function cleanCompletedPageData(pageId) {
  debugLog('🧹 Cleaning completed page data', { pageId: pageId });
  
  try {
    let cleanedCount = 0;
    
    // Delete status control
    deleteFromStorage(`${STORAGE_CONFIG.statusPath}/${pageId}`);
    cleanedCount++;
    
    // Delete raw files for this page
    const stats = getStorageStats();
    if (stats && stats.entries) {
      const pageEntries = stats.entries.filter(entry => 
        entry.path.includes(`/${pageId}/`) || entry.path.endsWith(`/${pageId}`)
      );
      
      pageEntries.forEach(entry => {
        deleteFromStorage(entry.path);
        cleanedCount++;
      });
    }
    
    debugLog('✅ Page data cleanup completed', { 
      pageId: pageId,
      itemsCleaned: cleanedCount
    });
    
    return cleanedCount;
    
  } catch (error) {
    debugLog('❌ Error cleaning page data', { 
      pageId: pageId,
      error: error.toString() 
    });
    return 0;
  }
}