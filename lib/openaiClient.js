const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const DEFAULT_RETRY_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.OPENAI_RETRY_ATTEMPTS || 2)));
const BASE_RETRY_DELAY_MS = 800;

function getOpenAIConfigError() {
  if (!process.env.OPENAI_API_KEY) {
    return 'OPENAI_API_KEY is not configured on the backend.';
  }

  return null;
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

function shouldRetryRequest(error) {
  if (error?.name === 'AbortError') {
    return true;
  }

  return [408, 409, 429, 500, 502, 503, 504].includes(Number(error?.statusCode || 0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestStructuredResponse({
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

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message ||
        payload?.message ||
        'OpenAI request failed.'
      );
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }

    const textOutput = extractTextOutput(payload);

    if (!textOutput) {
      const error = new Error('OpenAI returned an empty structured response.');
      error.statusCode = 502;
      error.payload = payload;
      throw error;
    }

    try {
      return JSON.parse(textOutput);
    } catch (parseError) {
      const error = new Error('OpenAI returned invalid JSON for a structured response.');
      error.statusCode = 502;
      error.payload = payload;
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
  }
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
