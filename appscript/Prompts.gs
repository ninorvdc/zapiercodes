// ==================== PROMPT TEMPLATES ====================
// Centralized prompt templates for different LLM tasks

const PROMPT_TEMPLATES = {
  // Main document analysis prompt
  mainDocument: {
    general: `You are analyzing a document from Notion.

Title: {{pageTitle}}
Content Length: {{contentLength}} characters

Please provide a comprehensive summary following this structure:

# Executive Summary
[2-3 sentence overview of the main points]

## Key Topics & Insights
[Bullet points of the most important topics discussed]

## Technical Details
[Any technical information, metrics, or specific data points]

## Areas of Concern
[Any issues, blockers, or concerns raised]

## Next Steps & Recommendations
[Suggested actions or follow-ups based on the content]

---

Here is the content to analyze:

{{content}}`,

    meeting: `You are analyzing a meeting transcription from Notion.

Title: {{pageTitle}}
Content Length: {{contentLength}} characters

Please provide a comprehensive summary following this structure:

# Executive Summary
[2-3 sentence overview of the meeting's main points and outcomes]

## Key Topics & Insights
[Bullet points of the most important topics discussed]

## Action Items & Decisions
[List any specific action items, decisions made, or next steps with owners if mentioned]

## Participants & Roles
[List key participants mentioned and their roles/contributions]

## Technical Details
[Any technical information, metrics, or specific data points discussed]

## Areas of Concern
[Any issues, blockers, or concerns raised during the meeting]

## Next Steps & Follow-ups
[Scheduled follow-ups, deadlines, or next meeting topics]

---

Here is the meeting content to analyze:

{{content}}`
  },

  // Chunk processing prompts
  chunk: {
    standard: `You are analyzing chunk {{chunkNumber}} of {{totalChunks}} from a larger document.

Please extract and summarize the key information from this chunk:

## Chunk {{chunkNumber}} Summary

### Key Points
[Extract the main points from this chunk]

### Decisions & Actions
[Any decisions made or actions mentioned]

### Metrics & Data
[Any specific metrics, numbers, or data points]

### Technical Information
[Technical details or specifications]

---

Chunk content:

{{content}}`,

    meeting: `You are analyzing chunk {{chunkNumber}} of {{totalChunks}} from a meeting transcription.

Focus on extracting:

## Chunk {{chunkNumber}} - Meeting Content

### Discussion Points
[Main topics discussed in this section]

### Speakers & Contributions
[Who said what - key contributions]

### Action Items
[Any tasks or follow-ups mentioned]

### Decisions
[Any decisions made in this section]

---

Meeting chunk content:

{{content}}`
  },

  // Combine chunks prompts
  combine: {
    standard: `You have multiple chunk summaries from a document. Please combine them into a cohesive executive summary.

Focus on:
1. Identifying the most important themes across all chunks
2. Consolidating related points
3. Highlighting key decisions and action items
4. Preserving important technical details
5. Creating a logical flow

Please structure the combined summary as:

# Document Summary

## Executive Overview
[High-level summary in 2-3 sentences]

## Main Topics
[Consolidated key points organized by theme]

## Important Details
[Technical specs, metrics, data points]

## Conclusions & Next Steps
[Overall conclusions and recommended actions]

Here are the chunk summaries to combine:

{{summaries}}`,

    meeting: `You have multiple chunk summaries from a meeting transcription. Please combine them into a cohesive meeting summary.

Focus on:
1. Creating a chronological flow of the meeting
2. Consolidating all action items with owners
3. Highlighting key decisions made
4. Identifying main discussion themes
5. Preserving important details and context

Please structure the combined summary as:

# Meeting Summary

## Executive Overview
[What was the meeting about and what was accomplished - 2-3 sentences]

## Key Discussion Topics
[Main themes discussed, organized by importance]

## Decisions Made
[All decisions with context and rationale]

## Action Items
[Complete list with owners and deadlines if mentioned]

## Participants & Contributions
[Key participants and their main contributions]

## Next Steps
[Follow-ups, next meetings, open items]

Here are the chunk summaries to combine:

{{summaries}}`
  },

  // Specialized prompts for different content types
  specialized: {
    technicalDoc: `You are analyzing a technical document. Focus on:
- Technical specifications and requirements
- Architecture and design decisions
- Implementation details
- Performance metrics
- Security considerations
- Dependencies and integrations

Content: {{content}}`,

    projectUpdate: `You are analyzing a project update. Focus on:
- Current project status and progress
- Completed milestones
- Blockers and risks
- Resource needs
- Timeline updates
- Key metrics and KPIs

Content: {{content}}`,

    productRequirements: `You are analyzing a product requirements document. Focus on:
- User stories and use cases
- Functional requirements
- Non-functional requirements
- Acceptance criteria
- Dependencies
- Timeline and prioritization

Content: {{content}}`,

    retrospective: `You are analyzing a retrospective meeting. Focus on:
- What went well
- What didn't go well
- Action items for improvement
- Team feedback and sentiment
- Process improvements
- Lessons learned

Content: {{content}}`
  },

  // Error and fallback prompts
  error: {
    contentTooShort: `The provided content appears to be very short. Please provide a brief summary of:

{{content}}

Focus on extracting any meaningful information available.`,

    contentError: `The content appears to have processing errors or formatting issues. Please do your best to extract meaningful information from:

{{content}}

Note any areas where the content seems corrupted or unclear.`
  },

  // External content prompts (for Google Docs, etc)
  external: {
    googleDoc: `You are analyzing content from a Google Doc linked in a Notion page.

Document URL: {{url}}
Extracted from Notion page: {{pageTitle}}

Please summarize the Google Doc content focusing on how it relates to the main Notion page.

Content:
{{content}}`,

    general: `You are analyzing external content linked from a Notion page.

Source URL: {{url}}
Source Type: {{type}}
Parent Page: {{pageTitle}}

Please summarize this external content and explain its relevance to the main document.

Content:
{{content}}`
  }
};

// Fortis Games specific templates (if needed)
const FORTIS_TEMPLATES = {
  checkIn: `You are analyzing an internal Fortis Games QVR or Pulse Check document.  
Your goal is to create a **condensed but comprehensive executive extract** — preserving context and nuance, not just headlines — while sanitizing sensitive information.  

The output will be organized by functional sections and include detailed bullet points under each category.  

---

### 1️⃣ OUTPUT STRUCTURE (Markdown)

# 🧩 Executive Check-in Summary

### 🗓️ Key Dates (Overall)
- [Milestone Start/End, major tests, offsite dates, releases, etc.]

---

## 🎮 Overall Game Team
**Summary (3–5 lines):** short paragraph of general progress, morale, validation status, and high-level focus.  

### ✨ Opportunities
- [Detailed but concise insight — up to 25 words each, include what/why it matters]
- ...

### 🧱 Obstacles
- [Specific blockers, root causes, and cross-team dependencies; aim for clarity not brevity]
- ...

### 🎯 This Milestone's Expectations
- [Expected measurable outcomes — connect to hypotheses or next milestone goals]
- ...

---

## 🧰 Central Tech / Engineering
**Summary (3–5 lines):** technical progress, migrations, infra readiness, and cross-collaboration highlights.  

### ✨ Opportunities
- ...
### 🧱 Obstacles
- ...
### 🎯 Expectations
- ...

---

## 🎨 EMV / Publishing / Art & Marketing Validation
**Summary (3–5 lines):** include test purposes, participant types, major validation findings, and next actions.  

### ✨ Opportunities
- ...
### 🧱 Obstacles
- ...
### 🎯 Expectations
- ...

---

## 📈 Narrative & Creative Direction
**Summary (3–5 lines):** include narrative rationale, art-narrative connection, tone improvements, and creative alignment.  

### ✨ Opportunities
- ...
### 🧱 Obstacles
- ...
### 🎯 Expectations
- ...

---

## 🧩 Next Steps
- [Top next actions, sequencing, or decision dependencies]  

---

2️⃣ EXTRACTION RULES  
- Preserve **quantitative data, metrics, and outcomes** (percentages, counts, timing, audience sizes, validation signals).  
- Keep **links to validation reports or tests** if they appear public-safe (Google Docs or test references).  
- Avoid rewriting every sentence — compress logically related paragraphs into grouped bullets.  
- Keep references to **projects or teams** (Lotus, Atlas, etc.) unless flagged as private.  

3️⃣ SANITIZATION RULES  
- Replace names with **roles** ("QA Lead", "Engineer", "Producer").  
- Remove any performance or HR evaluation content.  
- Remove family, health, or salary info.  
- Replace sensitive vendor names with "partner vendor".  
- Do not remove useful technical or analytical detail — only redact private content.  
- If something seems sensitive but critical to understanding context, keep it but generalize wording (e.g., "engineering shortages" instead of "John is out on leave").  

4️⃣ STYLE  
- Use clear, professional English (no filler).  
- Up to 5 bullets per sub-section, but each bullet can hold one full idea (not forced short).  
- Prefer full reasoning ("because", "due to", "resulting in") instead of vague statements.  
- Keep emojis only in headers.  
- Include all insights that could be useful for strategy, prioritization, or risk management.  

5️⃣ FAILSAFE  
If information cannot be safely included, note:  
> _(Omitted sensitive details for sanitization.)_

---

Now process the following QVR or Pulse Check text and produce the Condensed Sanitary Executive Extract:

{{content}}`,

  gameUpdate: `Analyze this game development update using Fortis Games format:

## 🎮 Game Status Update

### 📈 Metrics & KPIs
[User engagement, retention, monetization metrics]

### 🚀 Features Released
[New features and improvements]

### 🔧 Technical Updates
[Backend, infrastructure, performance updates]

### 🎨 Art & Design Progress
[Visual updates, UI/UX improvements]

### 📊 Player Feedback
[Key feedback points and responses]

Content:
{{content}}`
};

// Helper function to process template with variables
function processPromptTemplate(template, variables) {
  let processedTemplate = template;
  
  Object.keys(variables).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processedTemplate = processedTemplate.replace(regex, variables[key]);
  });
  
  return processedTemplate;
}

// Get appropriate prompt based on document type
function getPromptTemplate(documentType, promptType = 'mainDocument') {
  switch (documentType) {
    case 'meeting':
      return PROMPT_TEMPLATES[promptType]?.meeting || PROMPT_TEMPLATES[promptType]?.standard;
    
    case 'technical':
      return PROMPT_TEMPLATES.specialized.technicalDoc;
    
    case 'project_update':
      return PROMPT_TEMPLATES.specialized.projectUpdate;
    
    case 'retrospective':
      return PROMPT_TEMPLATES.specialized.retrospective;
    
    case 'fortis_checkin':
      return FORTIS_TEMPLATES.checkIn;
    
    case 'fortis_game_update':
      return FORTIS_TEMPLATES.gameUpdate;
    
    default:
      return PROMPT_TEMPLATES[promptType]?.general || PROMPT_TEMPLATES[promptType]?.standard;
  }
}

// Detect document type from content
function detectDocumentType(content, title = '') {
  const contentLower = (content + ' ' + title).toLowerCase();
  
  // Check for Fortis Games specific formats first (higher priority)
  const fortisKeywords = ['pulse check', 'milestone', 'game team', 'atlas', 'lotus', 'blockers', 'team health', 'team status', 'key takeaways'];
  const fortisScore = fortisKeywords.filter(keyword => contentLower.includes(keyword)).length;
  
  if (fortisScore >= 3 || contentLower.includes('pulse check') || contentLower.includes('milestone')) {
    return 'fortis_checkin';
  }
  
  // Check for other Fortis indicators
  if (contentLower.includes('fortis') || contentLower.includes('game team') || contentLower.includes('engineering capacity')) {
    if (contentLower.includes('check-in') || contentLower.includes('checkin') || contentLower.includes('pulse')) {
      return 'fortis_checkin';
    }
    if (contentLower.includes('game update') || contentLower.includes('player')) {
      return 'fortis_game_update';
    }
  }
  
  // Check for meeting indicators
  const meetingKeywords = ['meeting', 'minutes', 'attendees', 'agenda', 'discussed'];
  const meetingScore = meetingKeywords.filter(keyword => contentLower.includes(keyword)).length;
  if (meetingScore >= 3) return 'meeting';
  
  // Check for retrospective
  if (contentLower.includes('retrospective') || contentLower.includes('retro')) {
    return 'retrospective';
  }
  
  // Check for technical document
  const techKeywords = ['api', 'endpoint', 'database', 'architecture', 'implementation'];
  const techScore = techKeywords.filter(keyword => contentLower.includes(keyword)).length;
  if (techScore >= 3) return 'technical';
  
  // Check for project update
  if (contentLower.includes('project update') || contentLower.includes('status update')) {
    return 'project_update';
  }
  
  return 'general';
}

// Create prompt with automatic template selection
function createSmartPrompt(content, pageTitle, options = {}) {
  const documentType = options.documentType || detectDocumentType(content, pageTitle);
  const promptType = options.promptType || 'mainDocument';
  
  const template = getPromptTemplate(documentType, promptType);
  
  const variables = {
    content: content,
    pageTitle: pageTitle,
    contentLength: content.length,
    chunkNumber: options.chunkNumber || 1,
    totalChunks: options.totalChunks || 1,
    summaries: options.summaries || '',
    url: options.url || '',
    type: options.type || 'document'
  };
  
  return processPromptTemplate(template, variables);
}

// Create separated prompt and template for Zapier (where prompt = template, raw_text = content)
function createZapierPromptStructure(content, pageTitle, options = {}) {
  const documentType = options.documentType || detectDocumentType(content, pageTitle);
  const promptType = options.promptType || 'mainDocument';
  
  debugLog('🔍 Creating Zapier prompt structure', {
    documentType: documentType,
    promptType: promptType,
    contentLength: content.length,
    pageTitle: pageTitle
  });
  
  const template = getPromptTemplate(documentType, promptType);
  
  debugLog('📋 Template retrieved', {
    templateLength: template ? template.length : 0,
    templatePreview: template ? template.substring(0, 200) + '...' : 'null'
  });
  
  const result = {
    prompt: template, // The instruction template for Zapier
    rawContent: content, // Just the raw content 
    documentType: documentType
  };
  
  debugLog('✅ Zapier structure created', {
    promptLength: result.prompt ? result.prompt.length : 0,
    rawContentLength: result.rawContent ? result.rawContent.length : 0,
    promptIsTemplate: result.prompt !== content
  });
  
  return result;
}