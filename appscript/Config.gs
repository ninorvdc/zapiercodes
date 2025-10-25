// ==================== CONFIGURATION ====================
// Advanced Notion to Drive Summarizer with Multi-LLM Support
// Configuration file for all constants and settings

// Change this to switch between LLMs: 'claude', 'openai', 'gemini', or 'zapier_webhook'
const ACTIVE_LLM = 'zapier_webhook'; // <-- Change this to switch LLMs

// LLM Configuration
const LLM_CONFIG = {
  claude: {
    apiKeyName: 'CLAUDE_API_KEY',
    model: 'claude-3-5-sonnet-20241022', // Updated to latest model
    maxTokens: 4096,
    temperature: 0.3
  },
  openai: {
    apiKeyName: 'OPENAI_API_KEY', 
    model: 'gpt-4o', // Updated to latest model
    maxTokens: 4096,
    temperature: 0.3
  },
  gemini: {
    apiKeyName: 'GEMINI_API_KEY',
    model: 'gemini-1.5-pro', // Updated to latest model
    maxTokens: 4096,
    temperature: 0.3
  },
  zapier_webhook: {
    urlPropertyName: 'ZAPIER_SUMMARY_WEBHOOK_URL',
    defaultUrl: 'https://hooks.zapier.com/hooks/catch/23496639/urc0dgd/',
    timeout: 60000,
    defaultProvider: 'openai',
    defaultModel: 'openai/gpt-5-mini',
    defaultAuthentication: 'Zapier-provided'
  }
};

// Other Configuration
const NOTION_VERSION = '2025-09-03';
const NOTION_API_BASE_URL = 'https://api.notion.com/v1';
const INCLUDE_COMMENTS = false;
const ENABLE_WEBHOOK = true;
const WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/23496639/urybppi/';

// Rate limiting configuration
const LLM_RATE_LIMIT_DELAY = 10000; // 10 seconds between LLM calls for large transcriptions
const MAX_RETRIES = 5; // Increased retries
const CHUNK_SIZE = 15000; // Process content in smaller chunks to avoid rate limits

// Storage configuration - using Properties Service only (simpler and more reliable)
const STORAGE_CONFIG = {
  // Properties Service (persistent, 500KB per property, 9MB total)
  maxChunkSize: 450000, // Leave room for metadata
  maxTotalSize: 8000000, // Conservative 8MB limit
  
  // Cleanup settings
  autoCleanup: true,
  maxAge: 24, // hours - keep data for 24 hours
  maxEntries: 50, // max number of stored items before cleanup
  
  // File storage paths
  rawFilesPath: 'raw_files',
  processedFilesPath: 'processed_files',
  statusPath: 'status_control',
  logsPath: 'logs'
};

// Global variables for debugging and state
let DEBUG_MODE = false;
let DEBUG_LOGS = [];
const CONTENT_ISSUES = [];