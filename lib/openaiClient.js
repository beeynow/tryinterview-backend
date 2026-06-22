const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const OPENROUTER_CHAT_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const DEFAULT_RETRY_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.OPENAI_RETRY_ATTEMPTS || 2)));
const BASE_RETRY_DELAY_MS = 800;

function getOpenAIConfigError() {
  if (!process.env.OPENAI_API_KEY) {
    return 'OPENAI_API_KEY is not configured on the backend.';
  }

  return null;
}

function isOpenRouterKey() {
  return String(process.env.OPENAI_API_KEY || '').startsWith('sk-or-');
}

function getConfiguredApiUrl() {
  const configuredUrl = process.env.OPENAI_API_URL || process.env.OPENROUTER_API_URL;
  if (configuredUrl) {
    return configuredUrl;
  }

  const configuredBaseUrl = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL;
  if (configuredBaseUrl) {
    return `${configuredBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  return isOpenRouterKey() ? OPENROUTER_CHAT_API_URL : OPENAI_RESPONSES_API_URL;
}

function usesChatCompletions(apiUrl) {
  return String(apiUrl || '').includes('/chat/completions');
}

function usesOpenRouter(apiUrl) {
  return isOpenRouterKey() || String(apiUrl || '').includes('openrouter.ai');
}

function extractTextOutput(responsePayload) {
  if (typeof responsePayload?.output_text === 'string' && responsePayload.output_text.trim()) {
    return responsePayload.output_text;
  }

  const textChunks = [];

  for (const outputItem of responsePayload?.output || []) {
    for (const contentItem of outputItem?.content || []) {
      if (typeof contentItem?.text === 'string') {
        textChunks.push(contentItem.text);
      } else if (typeof contentItem?.value === 'string') {
        textChunks.push(contentItem.value);
      }
    }
  }

  return textChunks.join('\n').trim();
}

function extractChatTextOutput(responsePayload) {
  const content = responsePayload?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.value || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return typeof content === 'string' ? content.trim() : '';
}

function extractJsonText(textOutput) {
  const trimmedOutput = String(textOutput || '').trim();

  if (!trimmedOutput) {
    return '';
  }

  const fencedMatch = trimmedOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmedOutput;
  const firstObjectIndex = candidate.indexOf('{');
  const lastObjectIndex = candidate.lastIndexOf('}');

  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    return candidate.slice(firstObjectIndex, lastObjectIndex + 1);
  }

  return candidate;
}

function parseStructuredJson(textOutput, payload) {
  try {
    return JSON.parse(extractJsonText(textOutput));
  } catch (parseError) {
    const error = new Error('AI provider returned invalid JSON for a structured response.');
    error.statusCode = 502;
    error.payload = payload;
    throw error;
  }
}

function shouldRetryRequest(error) {
  if (error?.name === 'AbortError') {
    return true;
  }

  return [408, 409, 429, 500, 502, 503, 504].includes(Number(error?.statusCode || 0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequestHeaders(apiUrl) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };

  if (usesOpenRouter(apiUrl)) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || process.env.FRONTEND_URL || 'https://www.tryinterviews.site';
    headers['X-Title'] = process.env.OPENROUTER_APP_NAME || 'TryInterview';
  }

  return headers;
}

function buildStructuredJsonInstruction({ schemaName, schema }) {
  return [
    `Return only valid JSON for schema "${schemaName}".`,
    'Do not include markdown, code fences, prose before JSON, or prose after JSON.',
    'The JSON must match this schema:',
    JSON.stringify(schema),
  ].join('\n');
}

async function postStructuredRequest(apiUrl, requestBody, signal) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    signal,
    headers: buildRequestHeaders(apiUrl),
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ||
      payload?.message ||
      'AI provider request failed.'
    );
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function requestResponsesStructuredResponse({
  apiUrl,
  model,
  instructions,
  input,
  schemaName,
  schema,
  safetyIdentifier,
  reasoningEffort,
  maxOutputTokens,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const requestBody = {
      model,
      instructions,
      input,
      store: false,
      reasoning: {
        effort: reasoningEffort,
      },
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema,
        },
      },
    };

    if (safetyIdentifier) {
      requestBody.safety_identifier = safetyIdentifier;
    }

    const payload = await postStructuredRequest(apiUrl, requestBody, controller.signal);

    const textOutput = extractTextOutput(payload);

    if (!textOutput) {
      const error = new Error('AI provider returned an empty structured response.');
      error.statusCode = 502;
      error.payload = payload;
      throw error;
    }

    return parseStructuredJson(textOutput, payload);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestChatStructuredResponse({
  apiUrl,
  model,
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const structuredInstruction = buildStructuredJsonInstruction({ schemaName, schema });
  const baseRequestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: [instructions, structuredInstruction].filter(Boolean).join('\n\n'),
      },
      {
        role: 'user',
        content: input,
      },
    ],
    temperature: 0.35,
    max_tokens: maxOutputTokens,
  };
  const requestBodies = [
    {
      ...baseRequestBody,
      response_format: {
        type: 'json_object',
      },
    },
    baseRequestBody,
  ];
  let lastError = null;

  try {
    for (let index = 0; index < requestBodies.length; index += 1) {
      try {
        const payload = await postStructuredRequest(apiUrl, requestBodies[index], controller.signal);
        const textOutput = extractChatTextOutput(payload);

        if (!textOutput) {
          const error = new Error('AI provider returned an empty structured response.');
          error.statusCode = 502;
          error.payload = payload;
          throw error;
        }

        return parseStructuredJson(textOutput, payload);
      } catch (error) {
        lastError = error;
        const message = String(error?.message || '').toLowerCase();
        const canRetryWithoutResponseFormat = index === 0 &&
          [400, 422, 502].includes(Number(error?.statusCode));

        if (!canRetryWithoutResponseFormat) {
          throw error;
        }
      }
    }

    throw lastError;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestStructuredResponse(options) {
  const apiUrl = getConfiguredApiUrl();

  if (usesChatCompletions(apiUrl)) {
    return requestChatStructuredResponse({
      ...options,
      apiUrl,
    });
  }

  return requestResponsesStructuredResponse({
    ...options,
    apiUrl,
  });
}

async function createStructuredResponse({
  model,
  fallbackModel = null,
  instructions,
  input,
  schemaName,
  schema,
  safetyIdentifier = null,
  reasoningEffort = 'low',
  maxOutputTokens = 1800,
}) {
  const configError = getOpenAIConfigError();
  if (configError) {
    const error = new Error(configError);
    error.statusCode = 503;
    throw error;
  }

  const modelsToTry = Array.from(new Set([model, fallbackModel].filter(Boolean)));
  let lastError = null;

  for (const activeModel of modelsToTry) {
    for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await requestStructuredResponse({
          model: activeModel,
          instructions,
          input,
          schemaName,
          schema,
          safetyIdentifier,
          reasoningEffort,
          maxOutputTokens,
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          const timeoutError = new Error('OpenAI request timed out.');
          timeoutError.statusCode = 504;
          lastError = timeoutError;
        } else {
          lastError = error;
        }

        if (!shouldRetryRequest(lastError) || attempt >= DEFAULT_RETRY_ATTEMPTS) {
          break;
        }

        await delay(BASE_RETRY_DELAY_MS * attempt);
      }
    }

    if (!shouldRetryRequest(lastError)) {
      break;
    }
  }

  throw lastError;
}

module.exports = {
  createStructuredResponse,
  getOpenAIConfigError,
};
