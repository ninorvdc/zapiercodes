// ==================== LLM PROVIDERS ====================
// API integration functions for Claude, OpenAI, and Gemini

// Claude API
function callClaude(prompt, options = {}) {
  const config = LLM_CONFIG.claude;
  const apiKey = PropertiesService.getScriptProperties().getProperty(config.apiKeyName);

  if (!apiKey) {
    debugLog('Claude API key not found');
    return null;
  }

  const payload = {
    model: options.model || config.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens || config.maxTokens,
    temperature: options.temperature || config.temperature
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    debugLog('Claude response code:', responseCode);

    if (responseCode === 200) {
      const data = JSON.parse(response.getContentText());
      return data.content[0].text;
    } else {
      const errorText = response.getContentText();
      debugLog('Claude API error:', errorText);

      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error && (errorData.error.type === 'rate_limit_error' || errorData.error.message.includes('acceleration limit'))) {
          throw new Error(`Rate limit: ${errorData.error.message}`);
        }
      } catch (parseError) {
        // Ignore parse errors
      }

      return null;
    }
  } catch (error) {
    debugLog('Error calling Claude:', error.toString());
    throw error;
  }
}

// OpenAI API
function callOpenAI(prompt, options = {}) {
  const config = LLM_CONFIG.openai;
  const apiKey = PropertiesService.getScriptProperties().getProperty(config.apiKeyName);

  if (!apiKey) {
    debugLog('OpenAI API key not found');
    return null;
  }

  const payload = {
    model: options.model || config.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens || config.maxTokens,
    temperature: options.temperature || config.temperature
  };

  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    debugLog('OpenAI response code:', responseCode);

    if (responseCode === 200) {
      const data = JSON.parse(response.getContentText());
      return data.choices[0].message.content;
    } else {
      debugLog('OpenAI API error:', response.getContentText());
      return null;
    }
  } catch (error) {
    debugLog('Error calling OpenAI:', error.toString());
    throw error;
  }
}

// Gemini API helper functions
function extractGeminiText(responseData) {
  if (!responseData || !responseData.candidates) {
    return {
      text: null,
      meta: {
        candidateCount: 0
      }
    };
  }

  const candidates = responseData.candidates;
  const candidateCount = Array.isArray(candidates) ? candidates.length : 0;

  if (!Array.isArray(candidates) || candidateCount === 0) {
    return {
      text: null,
      meta: {
        candidateCount: candidateCount
      }
    };
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) {
      continue;
    }

    const content = candidate.content;
    if (content && Array.isArray(content.parts)) {
      const textParts = content.parts
        .map(part => (part && typeof part.text === 'string') ? part.text.trim() : '')
        .filter(partText => partText.length > 0);

      if (textParts.length > 0) {
        return {
          text: textParts.join('\n'),
          meta: {
            candidateIndex: i,
            source: 'content.parts',
            partCount: textParts.length
          }
        };
      }
    }

    if (Array.isArray(candidate.parts)) {
      const legacyParts = candidate.parts
        .map(part => {
          if (!part) return '';
          if (typeof part === 'string') return part.trim();
          if (typeof part.text === 'string') return part.text.trim();
          return '';
        })
        .filter(partText => partText.length > 0);

      if (legacyParts.length > 0) {
        return {
          text: legacyParts.join('\n'),
          meta: {
            candidateIndex: i,
            source: 'candidate.parts',
            partCount: legacyParts.length
          }
        };
      }
    }

    if (content && typeof content.text === 'string' && content.text.trim().length > 0) {
      return {
        text: content.text.trim(),
        meta: {
          candidateIndex: i,
          source: 'content.text',
          partCount: 1
        }
      };
    }

    if (typeof candidate.output === 'string' && candidate.output.trim().length > 0) {
      return {
        text: candidate.output.trim(),
        meta: {
          candidateIndex: i,
          source: 'output',
          partCount: 1
        }
      };
    }

    if (Array.isArray(candidate.output)) {
      const outputParts = candidate.output
        .map(part => {
          if (!part) return '';
          if (typeof part === 'string') return part.trim();
          if (typeof part.text === 'string') return part.text.trim();
          return '';
        })
        .filter(partText => partText.length > 0);

      if (outputParts.length > 0) {
        return {
          text: outputParts.join('\n'),
          meta: {
            candidateIndex: i,
            source: 'candidate.output',
            partCount: outputParts.length
          }
        };
      }
    }
  }

  return {
    text: null,
    meta: {
      candidateCount: candidateCount,
      error: 'No valid text found in any candidate'
    }
  };
}

function normalizeGeminiModelName(model) {
  if (!model || typeof model !== 'string') {
    return 'gemini-1.5-pro';
  }

  const modelLower = model.toLowerCase();

  if (modelLower.includes('gemini-1.5-pro') || modelLower.includes('1.5-pro')) {
    return 'gemini-1.5-pro';
  }

  if (modelLower.includes('gemini-1.5-flash') || modelLower.includes('1.5-flash')) {
    return 'gemini-1.5-flash';
  }

  if (modelLower.includes('gemini-pro') || modelLower === 'pro') {
    return 'gemini-1.5-pro';
  }

  if (modelLower.includes('gemini-flash') || modelLower === 'flash') {
    return 'gemini-1.5-flash';
  }

  if (modelLower.includes('gemini')) {
    return 'gemini-1.5-pro';
  }

  return 'gemini-1.5-pro';
}

function getGeminiModelFallbackSequence(requestedModel) {
  const normalizedModel = normalizeGeminiModelName(requestedModel);

  if (normalizedModel === 'gemini-1.5-pro') {
    return [
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];
  }

  if (normalizedModel === 'gemini-1.5-flash') {
    return [
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];
  }

  return [
    'gemini-1.5-pro',
    'gemini-1.5-flash'
  ];
}

// Gemini API
function callGemini(prompt, options = {}) {
  const config = LLM_CONFIG.gemini;
  const apiKey = PropertiesService.getScriptProperties().getProperty(config.apiKeyName);

  if (!apiKey) {
    debugLog('Gemini API key not found');
    return null;
  }

  const requestedModel = options.model || config.model;
  const modelsToTry = getGeminiModelFallbackSequence(requestedModel);

  let lastError = null;

  for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
    const modelName = modelsToTry[attempt];

    try {
      debugLog(`Gemini attempt ${attempt + 1}: using model ${modelName}`);

      const payload = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: options.maxTokens || config.maxTokens,
          temperature: options.temperature || config.temperature
        }
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = UrlFetchApp.fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const responseCode = response.getResponseCode();
      debugLog(`Gemini ${modelName} response code:`, responseCode);

      if (responseCode === 200) {
        const responseText = response.getContentText();
        debugLog(`Gemini ${modelName} response received, length: ${responseText.length}`);

        const data = JSON.parse(responseText);
        const extraction = extractGeminiText(data);

        if (extraction.text) {
          debugLog(`Gemini ${modelName} success:`, {
            textLength: extraction.text.length,
            source: extraction.meta.source,
            candidateIndex: extraction.meta.candidateIndex
          });
          return extraction.text;
        } else {
          debugLog(`Gemini ${modelName} no valid text extracted:`, extraction.meta);
          lastError = new Error(`No valid text in Gemini response from ${modelName}`);
        }
      } else {
        const errorText = response.getContentText();
        debugLog(`Gemini ${modelName} API error [${responseCode}]:`, errorText);

        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            lastError = new Error(`Gemini ${modelName} error: ${errorData.error.message || errorData.error.code || 'Unknown error'}`);
          } else {
            lastError = new Error(`Gemini ${modelName} HTTP error: ${responseCode}`);
          }
        } catch (parseError) {
          lastError = new Error(`Gemini ${modelName} HTTP error: ${responseCode} - ${errorText.substring(0, 200)}`);
        }
      }
    } catch (error) {
      debugLog(`Gemini ${modelName} call failed:`, error.toString());
      lastError = error;

      if (attempt < modelsToTry.length - 1) {
        debugLog('Retrying Gemini call with fallback model after error', { currentModel: modelName });
        continue;
      }

      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}