const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const FORMATS = ["Coding", "Multiple Choice", "Short Question", "Long Question", "Database", "Frontend", "Debugging"];

const questionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          format: {
            type: "string",
            enum: FORMATS
          },
          title: { type: "string" },
          section: { type: "string" },
          prompt: { type: "string" },
          points: { type: "number" },
          options: {
            type: "array",
            items: { type: "string" }
          },
          starter: { type: "string" },
          answerGuide: { type: "string" }
        },
        required: ["format", "title", "section", "prompt", "points", "options", "starter", "answerGuide"]
      }
    },
    summary: { type: "string" },
    metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        detectedTestType: { type: "string" },
        detectedLanguage: { type: "string" },
        detectedDurationMinutes: { type: "number" }
      },
      required: ["detectedTestType", "detectedLanguage", "detectedDurationMinutes"]
    }
  },
  required: ["questions", "summary", "metadata"]
};

function normalizeQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => ({
      id: String(question?.id || `question-${index + 1}`),
      format: FORMATS.includes(question?.format) ? question.format : "Short Question",
      title: String(question?.title || `Question ${index + 1}`).trim(),
      section: String(question?.section || "").trim(),
      prompt: String(question?.prompt || "").trim(),
      points: Number(question?.points || 10),
      options: Array.isArray(question?.options) ? question.options.map(String) : [],
      starter: String(question?.starter || "").trim(),
      answerGuide: String(question?.answerGuide || "").trim()
    }))
    .filter((question) => question.title && question.prompt)
    .map((question) => ({
      ...question,
      points: Number.isFinite(question.points) && question.points > 0 ? question.points : 10
    }));
}

async function callOpenAI(messages) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured on the backend.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "exam_question_set",
          strict: true,
          schema: questionSchema
        }
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "OpenAI question generation failed.");
    error.statusCode = response.status;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("OpenAI did not return any question content.");
    error.statusCode = 502;
    throw error;
  }

  return JSON.parse(content);
}

function buildExamPrompt({
  title = "",
  testType = "Coding",
  language = "Python",
  durationMinutes = 90,
  topic = "",
  difficulty = "Intermediate",
  questionCount = 3,
  preferredFormats = [],
  notes = ""
}) {
  return [
    "Generate exam questions in JSON for a secure coding exam platform.",
    "Return questions that are teacher-ready and student-facing.",
    `Exam title: ${title || "Untitled Exam"}`,
    `Primary test type: ${testType}`,
    `Primary language: ${language}`,
    `Duration: ${durationMinutes} minutes`,
    `Topic or syllabus focus: ${topic || "General assessment"}`,
    `Difficulty: ${difficulty}`,
    `Question count: ${questionCount}`,
    `Preferred formats: ${preferredFormats.length ? preferredFormats.join(", ") : "Use a balanced mix that fits the exam type"}`,
    notes ? `Teacher notes: ${notes}` : "Teacher notes: none",
    "For multiple choice questions, include exactly 4 options.",
    "For coding, database, frontend, or debugging questions, include starter content when useful.",
    "For short questions, keep prompts concise.",
    "For long questions, allow deeper explanation and analysis tasks.",
    "In answerGuide, include the key marking points or correct answer.",
    "Add a short summary of the generated assessment."
  ].join("\n");
}

function summarizeText(text = "", maxLength = 280) {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Imported material was summarized into draft questions.";
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact;
}

function starterTemplateForLanguage(language = "") {
  const normalized = String(language || "").trim().toLowerCase();
  if (normalized === "rust") {
    return "fn solution() {\n    // TODO: implement\n}";
  }
  if (normalized === "python") {
    return "def solution():\n    pass";
  }
  return "";
}

function detectMetadata(sourceText = "", fallback = {}) {
  const text = String(sourceText);
  const lower = text.toLowerCase();
  const partMatches = lower.match(/\bpart\s+[a-z0-9]+\b/g) || [];
  const sectionMatches = lower.match(/\bsection\s+[a-z0-9]+\b/g) || [];

  const durationMatch = lower.match(/time allowed\s*[:\-]?\s*(\d+)\s*minutes?/i) || lower.match(/duration\s*[:\-]?\s*(\d+)\s*minutes?/i);
  const detectedDurationMinutes = durationMatch ? Number(durationMatch[1]) : Number(fallback.durationMinutes || 90);

  let detectedLanguage = fallback.language || "Python";
  if (/\brust\b|\brustc\b|\bcargo\b/.test(lower)) {
    detectedLanguage = "Rust";
  } else if (/\bjavascript\b|\bjs\b/.test(lower)) {
    detectedLanguage = "JavaScript";
  } else if (/\bjava\b/.test(lower) && !/\bjavascript\b/.test(lower)) {
    detectedLanguage = "Java";
  } else if (/\bsql\b/.test(lower)) {
    detectedLanguage = "SQL";
  } else if (/\bpython\b/.test(lower)) {
    detectedLanguage = "Python";
  }

  let detectedTestType = fallback.testType || "Coding";
  if (partMatches.length >= 2 || sectionMatches.length >= 2) {
    detectedTestType = "Mixed Format";
  } else if (/\bdebug\b|\bsyntax error\b|\bfix the code\b/.test(lower)) {
    detectedTestType = "Debugging";
  } else if (/\bsql\b|\bdatabase\b|\bquery\b/.test(lower)) {
    detectedTestType = "Database";
  } else if (/\bhtml\b|\bcss\b|\bfrontend\b|\bui\b/.test(lower)) {
    detectedTestType = "Frontend";
  } else if (/\bmultiple choice\b|\bchoose the correct answer\b|\bselect one answer\b/.test(lower)) {
    detectedTestType = "Multiple Choice";
  } else if (/\bessay\b|\bdiscuss\b|\bevaluate\b|\bjustify\b|\blong answer\b/.test(lower)) {
    detectedTestType = "Long Question";
  } else if (/\bshort questions?\b|\bexplain\b|\bdescribe\b|\bpseudocode\b/.test(lower)) {
    detectedTestType = "Short Question";
  }

  return {
    detectedTestType,
    detectedLanguage,
    detectedDurationMinutes
  };
}

function normalizeSourceText(sourceText = "") {
  const cleanedLines = String(sourceText)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(student name|student id|date|tutor|lecturer|course code|unit code)\b\s*:?\s*$/i.test(line))
    .filter((line) => !/^(read all questions carefully|time allowed|total marks|all digital devices must be turned off|don.?t start writing until you are told to|all answers .* written|all forms of plagiarism|end of test)$/i.test(line))
    .filter((line) => !/^(open book|open workbook|open work-book|worth \d+%|please answer the following questions\.?)$/i.test(line));

  return cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitQuestionBlocks(sourceText = "") {
  const text = normalizeSourceText(sourceText);
  if (!text) {
    return [];
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let current = null;
  let currentSection = "";

  const headingPattern = /^(question\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|q\s*\d+\b|\d+[\).:-])\s*(.*)$/i;
  const sectionPattern = /^(part\s+[a-z0-9]+\b|section\s+[a-z0-9]+\b)\s*[:\-]?\s*(.*)$/i;

  for (const line of lines) {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      currentSection = [sectionMatch[1], sectionMatch[2]].filter(Boolean).join(" ").trim();
      continue;
    }

    const match = line.match(headingPattern);
    if (match) {
      if (current) {
        blocks.push(current);
      }

      const heading = match[1].trim();
      const trailing = match[2].trim();
      current = {
        heading,
        title: trailing || heading,
        lines: trailing ? [line] : [heading],
        section: currentSection
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks
    .map((block, index) => ({
      ...block,
      title:
        block.title === block.heading
          ? `Imported Question ${index + 1}`
          : block.title.replace(/^[\-:\.)\s]+/, "").trim(),
      body: block.lines.join("\n").trim(),
      section: block.section || ""
    }))
    .filter((block) => block.body.length > 20);
}

function inferFormatFromBlock(blockText = "", testType = "Coding") {
  const text = String(blockText).toLowerCase();

  if (testType === "Database" || /\bsql\b|\bquery\b|\bdatabase\b|\bselect\b|\bjoin\b|\bwhere\b|\bfrom\b/.test(text)) {
    return "Database";
  }
  if (testType === "Frontend" || /\bhtml\b|\bcss\b|\bui\b|\bform\b|\blayout\b/.test(text)) {
    return "Frontend";
  }
  if (testType === "Debugging" || /\bdebug\b|\berror\b|\bfix\b|\bsyntax\b/.test(text)) {
    return "Debugging";
  }
  if (/\bprogram\b|\bpython\b|\bcode\b|\bfunction\b|\balgorithm\b/.test(text)) {
    return "Coding";
  }
  if (/\bmultiple choice\b|\bchoose\b|\bwhich\b/.test(text)) {
    return "Multiple Choice";
  }
  if (/\bessay\b|\bdiscuss\b|\bevaluate\b|\bcompare\b|\bjustify\b|\bcritically\b/.test(text)) {
    return "Long Question";
  }
  if (/\bpseudocode\b|\bexplain\b|\bdescribe\b|\btrace\b|\bflowchart\b/.test(text)) {
    return "Short Question";
  }
  return "Coding";
}

function extractOptions(blockText = "") {
  const lines = String(blockText).split("\n").map((line) => line.trim());
  const optionPattern = /^(?:[A-Da-d][\).:-]|[-*])\s+(.+)$/;
  const options = lines
    .map((line) => line.match(optionPattern))
    .filter(Boolean)
    .map((match) => match[1].trim());

  return options.length >= 2 ? options : [];
}

function buildStructuredFallback({
  sourceText = "",
  title = "",
  testType = "Coding",
  language = "Python",
  questionCount = 4
}) {
  const blocks = splitQuestionBlocks(sourceText).slice(0, Math.max(1, questionCount));
  if (!blocks.length) {
    return null;
  }

  const questions = blocks.map((block, index) => {
    const format = inferFormatFromBlock(block.body, testType);
    const options = extractOptions(block.body);
    const starter = format === "Coding" ? starterTemplateForLanguage(language) : "";

    return {
      id: `structured-${index + 1}`,
      format: options.length >= 2 ? "Multiple Choice" : format,
      title: block.title || `${title || "Imported Exam"} Question ${index + 1}`,
      section: block.section,
      prompt: block.body,
      points: 10,
      options,
      starter,
      answerGuide: "Review the imported source and assess whether the student addresses the requirements in this question."
    };
  });

  return {
    questions,
    summary: `Imported ${questions.length} numbered questions from the source document.`,
    metadata: detectMetadata(sourceText, { testType, language })
  };
}

function fallbackFromText({
  sourceText = "",
  title = "",
  testType = "Coding",
  language = "Python",
  durationMinutes = 90,
  questionCount = 3
}) {
  const structured = buildStructuredFallback({
    sourceText,
    title,
    testType,
    language,
    questionCount
  });

  if (structured) {
    return structured;
  }

  const paragraphs = String(sourceText)
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length > 30);

  const picked = paragraphs.slice(0, Math.max(1, questionCount));
  const questions = picked.map((chunk, index) => {
    const format =
      testType === "Database" ? "Database" :
      testType === "Frontend" ? "Frontend" :
      testType === "Debugging" ? "Debugging" :
      index === 0 ? "Coding" : "Short Question";

    return {
      id: `fallback-${index + 1}`,
      format,
      title: `${title || "Imported Brief"} Task ${index + 1}`,
      section: "",
      prompt: `Based on this imported material, complete the following task:\n\n${chunk}`,
      points: 10,
      options: [],
      starter: format === "Coding" ? starterTemplateForLanguage(language) : "",
      answerGuide: "Review the imported source and assess whether the student addresses the key requirements."
    };
  });

  if (!questions.length) {
    questions.push({
      id: "fallback-1",
      format: "Short Question",
      title: `${title || "Imported Brief"} Summary Question`,
      section: "",
      prompt: `Read the imported material and explain the key task or requirement in your own words.\n\n${summarizeText(sourceText, 500)}`,
      points: 10,
      options: [],
      starter: "",
      answerGuide: "Look for accurate coverage of the main requirement from the imported document."
    });
  }

  return {
    questions,
    summary: summarizeText(sourceText),
    metadata: detectMetadata(sourceText, { testType, language, durationMinutes })
  };
}

async function generateQuestionsWithAI(input) {
  const parsed = await callOpenAI([
    {
      role: "system",
      content: "You create structured exam questions for teachers. Always return valid JSON matching the schema."
    },
    {
      role: "user",
      content: buildExamPrompt(input)
    }
  ]);

  return {
    questions: normalizeQuestions(parsed.questions),
    summary: String(parsed.summary || "").trim(),
    metadata: parsed.metadata || {
      detectedTestType: input.testType || "Coding",
      detectedLanguage: input.language || "Python",
      detectedDurationMinutes: Number(input.durationMinutes || 90)
    }
  };
}

async function importQuestionsFromDocument({
  title = "",
  testType = "Mixed Format",
  language = "Python",
  durationMinutes = 90,
  sourceText = "",
  questionCount = 4
}) {
  const prompt = [
    "You are helping a teacher turn an imported Word document into exam questions.",
    `Exam title: ${title || "Imported Exam"}`,
    `Test type: ${testType}`,
    `Primary language: ${language}`,
    `Duration: ${durationMinutes} minutes`,
    `Target question count: ${questionCount}`,
    "Read the imported material, summarize the main assessment intent, and produce clean question drafts.",
    "If the source already contains numbered questions, preserve that structure and split each numbered question into its own draft item.",
    "If the source contains Part A / Part B or Section headings, carry that section label into each related question.",
    "Remove non-question boilerplate such as student name fields, dates, integrity notices, general invigilator instructions, and end-of-test markers.",
    "Use the original question numbering and wording where practical, but rewrite into clean, organized prompts when the source is noisy.",
    "Keep questions realistic for the exam duration.",
    "Use mixed formats when it fits the source material.",
    "",
    "Imported material:",
    sourceText.slice(0, 12000)
  ].join("\n");

  try {
    const parsed = await callOpenAI([
      {
        role: "system",
        content: "You summarize teaching material and convert it into structured exam questions."
      },
      {
        role: "user",
        content: prompt
      }
    ]);

    return {
      questions: normalizeQuestions(parsed.questions),
      summary: String(parsed.summary || "").trim(),
      metadata: parsed.metadata || detectMetadata(sourceText, { testType, language, durationMinutes }),
      mode: "ai"
    };
  } catch (error) {
    return {
      ...fallbackFromText({ sourceText, title, testType, language, durationMinutes, questionCount }),
      mode: "fallback",
      fallbackReason: error.message
    };
  }
}

module.exports = {
  generateQuestionsWithAI,
  importQuestionsFromDocument
};

