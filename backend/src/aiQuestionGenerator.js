const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const FORMATS = ["Coding", "Multiple Choice", "Short Question", "Long Question", "Database", "Frontend", "Debugging"];

function extractLabeledItems(value = "") {
  const text = String(value).replace(/\r/g, " ");
  const markerPattern = /(?:^|\s)(?:\(([A-Ha-h])\)\.?|([A-Ha-h])\s*(?:\.\)|\)|\.|:|\-))\s+/g;
  const markers = [];
  let match;
  while ((match = markerPattern.exec(text))) {
    markers.push({ label: (match[1] || match[2]).toUpperCase(), start: match.index, contentStart: markerPattern.lastIndex });
  }
  const sequential = markers.filter((marker, index) => index === 0 || marker.label.charCodeAt(0) === markers[index - 1].label.charCodeAt(0) + 1);
  if (sequential.length < 2 || sequential[0].label !== "A" || sequential[1].label !== "B") return [];
  return sequential.map((marker, index) => {
    const next = sequential[index + 1];
    return text.slice(marker.contentStart, next ? next.start : text.length).replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

function isWrittenSubquestionSet(items = [], context = "", requestedFormat = "") {
  const surrounding = `${requestedFormat} ${context}`.toLowerCase();
  if (/\b(short questions?|short answers?|long questions?|long answers?|essay|written response|theory)\b/.test(surrounding)) return true;
  if (items.some((item) => /\b\d+(?:\.\d+)?\s*marks?\b/i.test(item))) return true;
  const instructionPattern = /^(?:explain|describe|discuss|evaluate|compare|contrast|justify|define|outline|summarize|analyse|analyze|write|create|implement|calculate|show|prove|identify|state|what|why|how)\b/i;
  const instructionCount = items.filter((item) => instructionPattern.test(item) || /\?$/.test(item.trim())).length;
  return instructionCount >= Math.min(2, items.length);
}

function extractLabeledOptions(value = "", context = "", requestedFormat = "") {
  const items = extractLabeledItems(value);
  if (items.length < 2) return [];
  const surrounding = `${requestedFormat} ${context} ${value}`.toLowerCase();
  if (/\b(multiple choice|mcq|choose (?:one|the correct|the best)|select one|which (?:of|is|statement))\b/.test(surrounding)) return items;
  return isWrittenSubquestionSet(items, context, requestedFormat) ? [] : items;
}

function normalizeFormat(question = {}) {
  const requestedFormat = question.format || question.questionType || question.type || "";
  const context = `${question.section || ""} ${question.title || ""}`;
  const labeledOptions = extractLabeledOptions(question.prompt || "", context, requestedFormat);
  const options = Array.isArray(question.options) ? question.options.filter((option) => String(option).trim()) : [];
  if (labeledOptions.length >= 2) return "Multiple Choice";
  const requested = String(question.format || question.questionType || question.type || "").trim().toLowerCase();
  const aliases = {
    code: "Coding", coding: "Coding", programming: "Coding", practical: "Coding",
    html: "Frontend", css: "Frontend", web: "Frontend", frontend: "Frontend",
    debug: "Debugging", debugging: "Debugging", correction: "Debugging",
    mcq: "Multiple Choice", multiplechoice: "Multiple Choice", "multiple choice": "Multiple Choice", choice: "Multiple Choice",
    short: "Short Question", "short answer": "Short Question", "short question": "Short Question",
    long: "Long Question", essay: "Long Question", "long answer": "Long Question", "long question": "Long Question",
    database: "Database", sql: "Database"
  };
  if (aliases[requested]) return aliases[requested];
  if (options.length >= 2) return "Multiple Choice";
  const text = `${question.title || ""} ${question.prompt || ""} ${question.starter || ""}`.toLowerCase();
  if (/\b(multiple choice|choose|select one|which of)\b/.test(text)) return "Multiple Choice";
  if (/\b(debug|fix|correct|error|bug|syntax)\b/.test(text)) return "Debugging";
  if (/\b(sql|database|query|select|join)\b/.test(text)) return "Database";
  if (/\b(html|css|webpage|web page|frontend|layout)\b/.test(text)) return "Frontend";
  if (/\b(write|create|implement|build|program|code|function|class|struct|algorithm)\b/.test(text) || question.starter) return "Coding";
  if (/\b(discuss|evaluate|justify|essay|critically|in detail)\b/.test(text)) return "Long Question";
  return "Short Question";
}

const questionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 50,
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
    .map((question, index) => {
      const prompt = String(question?.prompt || "").trim();
      const suppliedOptions = Array.isArray(question?.options) ? question.options.map(String).filter((option) => option.trim()) : [];
      const options = suppliedOptions.length >= 2
        ? suppliedOptions
        : extractLabeledOptions(prompt, `${question?.section || ""} ${question?.title || ""}`, question?.format || "");
      const prepared = { ...question, prompt, options };
      return {
        id: String(question?.id || `question-${index + 1}`),
        format: normalizeFormat(prepared),
        title: String(question?.title || `Question ${index + 1}`).trim(),
        section: String(question?.section || "").trim(),
        prompt,
        points: Number(question?.points || 10),
        options,
        starter: String(question?.starter || "").trim(),
        answerGuide: String(question?.answerGuide || "").trim()
      };
    })
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

function stripListPrefix(value = "") {
  return String(value).replace(/^\s*(?:[-*]\s+|(?:\d+|[a-z])\s*[\).:\-]\s+)/i, "").trim();
}

function isAdministrativeHeading(value = "") {
  const text = stripListPrefix(value).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:general )?(?:instructions?|rules?|procedures?|guidelines?|information|important information|candidate instructions?|student instructions?|exam instructions?|examination rules?|assessment rules?|academic integrity|before you begin|before the exam|during the exam|submission instructions?|submission procedures?|how to submit|technical requirements?|system requirements?|introduction|overview)$/.test(text);
}

function isAdministrativeLine(value = "") {
  const text = stripListPrefix(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(?:student|candidate)\s*(?:name|id|number|signature)|^(?:date|tutor|lecturer|course|unit|subject)\s*(?:code|name)?\s*:/i.test(text)) return true;
  return /^(?:time allowed|duration|reading time|total marks?|maximum marks?|number of questions?|exam date|assessment weight|worth\s+\d+%)/.test(text)
    || /^(?:read|check)\s+(?:all|each|the)\s+(?:questions?|instructions?|pages?)/.test(text)
    || /^(?:answer|attempt|complete)\s+(?:all|any|each|the)\s+(?:questions?|sections?|parts?)/.test(text)
    || /^(?:do not|don['’]?t)\s+(?:start|begin|open|turn|leave|communicate|talk|use|access|remove)/.test(text)
    || /^(?:all|any|no)\s+(?:digital|electronic|mobile|communication|reference)\s+(?:devices?|equipment|materials?)/.test(text)
    || /\b(?:mobile phones?|smart watches?|electronic devices?)\b.*\b(?:off|prohibited|permitted|allowed)\b/.test(text)
    || /\b(?:invigilator|proctor|exam supervisor)\b/.test(text)
    || /^(?:raise your hand|remain seated|keep silent|no talking|no communication|internet access is|unauthori[sz]ed materials?)/.test(text)
    || /\b(?:cheating|plagiarism|academic misconduct|failure to comply)\b/.test(text)
    || /^(?:write|enter)\s+your\s+(?:name|student id|student number|candidate number)/.test(text)
    || /^(?:save|upload|submit|close|exit)\s+(?:your|the|all)\s+(?:work|answers?|files?|exam|application)/.test(text)
    || /^(?:marks? (?:are|will be)|the marks? for|each question is worth|all answers must be|answers? should be written)/.test(text)
    || /^(?:end of (?:test|exam|paper)|good luck|please answer the following questions?)\.?$/.test(text);
}

function normalizeSourceText(sourceText = "") {
  const cleanedLines = String(sourceText)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isAdministrativeLine(line));

  return cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasAssessmentEvidence(value = "", section = "") {
  const text = String(value).trim();
  if (!text || isAdministrativeHeading(text)) return false;
  const firstLine = stripListPrefix(text.split("\n")[0]);
  const sectionFormat = inferFormatFromSection(section);
  const hasMarks = /(?:\(|\[)?\d+(?:\.\d+)?\s*marks?(?:\)|\])?/i.test(text);
  const hasQuestionWording = /\?|^(?:what|why|when|where|which|who|how)\b/i.test(firstLine);
  const hasTaskVerb = /^(?:write|create|implement|build|develop|define|explain|describe|discuss|evaluate|compare|contrast|justify|calculate|compute|predict|trace|identify|state|list|outline|analyse|analyze|find|correct|debug|design|convert|complete|select|choose|determine|use)\b/i.test(firstLine);
  const hasChoices = /(?:^|\n)\s*(?:\(?a\)?[\).:\-])\s+.+(?:\n|[ \t]+)\s*(?:\(?b\)?[\).:\-])\s+/i.test(text);
  const hasCode = /\b(?:fn\s+main|def\s+\w+|class\s+\w+|struct\s+\w+|let\s+\w+|println?!|console\.log|select\s+.+\s+from|<html|function\s+\w+)\b/i.test(text);
  const adminOnly = text.split(/\n+/).filter(Boolean).every((line) => isAdministrativeLine(line) || isAdministrativeHeading(line));
  return !adminOnly && Boolean(sectionFormat || hasMarks || hasQuestionWording || hasTaskVerb || hasChoices || hasCode || /\bgiven the following\b/i.test(text));
}

function keepAssessmentQuestions(questions = []) {
  return questions.filter((question) => {
    const content = `${question.title || ""}\n${question.prompt || ""}`;
    return !isAdministrativeHeading(question.title) && hasAssessmentEvidence(content, question.section || "");
  });
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
  let ignoringAdministrativeSection = false;

  const headingPattern = /^(question\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[\s.):-]*|q\s*\d+\b[\s.):-]*|\d+[\).:-]\s*)(.*)$/i;
  const sectionPattern = /^(part\s+[a-z0-9]+\b|section\s+[a-z0-9]+\b)\s*[:\-–—]?\s*(.*)$/i;

  for (const line of lines) {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      currentSection = [sectionMatch[1], sectionMatch[2]].filter(Boolean).join(" ").trim();
      ignoringAdministrativeSection = isAdministrativeHeading(sectionMatch[2] || "");
      continue;
    }

    if (isAdministrativeHeading(line)) {
      if (current) blocks.push(current);
      current = null;
      currentSection = "";
      ignoringAdministrativeSection = true;
      continue;
    }

    const match = line.match(headingPattern);
    if (match) {
      if (ignoringAdministrativeSection && !hasAssessmentEvidence(match[2], currentSection)) continue;
      ignoringAdministrativeSection = false;
      if (current) {
        blocks.push(current);
      }

      const heading = match[1].trim();
      const trailing = match[2].trim();
      current = {
        heading,
        title: trailing || "",
        lines: trailing ? [trailing] : [],
        section: currentSection
      };
      continue;
    }

    if (current && !isAdministrativeLine(line)) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks
    .map((block, index) => ({
      ...block,
      number: index + 1,
      title: block.title.replace(/^[\-:\.)\s]+/, "").trim() || `Question ${index + 1}`,
      body: block.lines.join("\n").trim(),
      section: block.section || ""
    }))
    .filter((block) => block.body.trim().length > 0)
    .filter((block) => hasAssessmentEvidence(`${block.title}\n${block.body}`, block.section));
}

function inferFormatFromSection(section = "") {
  const title = String(section).toLowerCase().replace(/[^a-z0-9+#&]+/g, " ").trim();
  if (!title) return "";
  if (/\b(multiple choice|multiple choices|mcq|objective questions?|choose (?:one|the correct)|select one)\b/.test(title)) return "Multiple Choice";
  if (/\b(short questions?|short answers?|brief answers?|concepts?|theory)\b/.test(title)) return "Short Question";
  if (/\b(long questions?|long answers?|extended responses?|essay questions?|essays?)\b/.test(title)) return "Long Question";
  if (/\b(debugging|debug|code correction|fix the code)\b/.test(title)) return "Debugging";
  if (/\b(frontend|front end|html|css|web design|web development)\b/.test(title)) return "Frontend";
  if (/\b(database|sql|queries)\b/.test(title)) return "Database";
  if (/\b(practical coding|coding|programming|practical exercises?|programming tasks?)\b/.test(title)) return "Coding";
  return "";
}

function inferFormatFromBlock(blockText = "", testType = "Coding", section = "") {
  const sectionFormat = inferFormatFromSection(section);
  if (sectionFormat) return sectionFormat;
  const text = `${section} ${blockText}`.toLowerCase();

  if (/\b(multiple choice|mcq|choose|select one|which of)\b/.test(text)) {
    return "Multiple Choice";
  }
  if (testType === "Database" || /\bsql\b|\bdatabase\b|\bdatabase query\b|\b(?:inner|left|right|outer) join\b|\bselect\s+.+\s+from\b/.test(text)) {
    return "Database";
  }
  if (testType === "Frontend" || /\bhtml\b|\bcss\b|\bui\b|\bform\b|\blayout\b/.test(text)) {
    return "Frontend";
  }
  if (testType === "Debugging" || /\bdebug\b|\berror\b|\bfix\b|\bsyntax\b/.test(text)) {
    return "Debugging";
  }
  if (/\b(practical coding|programming|write (?:a |an )?(?:program|function)|implement|create (?:a |an )?(?:program|function|class|struct)|python|rust|code|function|algorithm)\b/.test(text)) {
    return "Coding";
  }
  if (/\bessay\b|\bdiscuss\b|\bevaluate\b|\bcompare\b|\bjustify\b|\bcritically\b/.test(text)) {
    return "Long Question";
  }
  if (/\bpseudocode\b|\bexplain\b|\bdescribe\b|\btrace\b|\bflowchart\b/.test(text)) {
    return "Short Question";
  }
  if (/\b(short answers?|short questions?|concepts?|theory)\b/.test(text)) {
    return "Short Question";
  }
  return testType === "Mixed Format" ? "Short Question" : normalizeFormat({ format: testType });
}

function extractOptions(blockText = "", section = "", format = "") {
  return extractLabeledOptions(blockText, section, format);
}

function extractPoints(blockText = "") {
  const match = String(blockText).match(/\((\d+(?:\.\d+)?)\s*marks?\)|\[(\d+(?:\.\d+)?)\s*marks?\]|\b(\d+(?:\.\d+)?)\s*marks?\b/i);
  return match ? Number(match[1] || match[2] || match[3]) : 10;
}

function cleanQuestionLabel(value = "") {
  return String(value)
    .replace(/\s*[\[(]?\d+(?:\.\d+)?\s*marks?[\])]?\s*$/i, "")
    .trim();
}

function splitPromptAndAnswer(value = "") {
  const text = String(value).trim();
  const marker = /(?:^|\n)\s*(?:model answer|suggested answer|correct answer|answer key|answer|solution|marking guide|rubric)\s*:\s*/im;
  const match = marker.exec(text);
  if (!match) return { prompt: text, answerGuide: "" };
  return {
    prompt: text.slice(0, match.index).trim(),
    answerGuide: text.slice(match.index + match[0].length).trim()
  };
}

function extractGlobalAnswerKey(sourceText = "") {
  const text = String(sourceText);
  const heading = /(?:^|\n)\s*(?:answer key|answers|model answers)\s*:?\s*\n/im.exec(text);
  if (!heading) return { sourceText: text, answers: new Map() };
  const keyText = text.slice(heading.index + heading[0].length);
  const answers = new Map();
  const entryPattern = /(?:^|\n)\s*(?:question\s*|q\s*)?(\d+)\s*[\).:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:question\s*|q\s*)?\d+\s*[\).:\-])|$)/gi;
  let match;
  while ((match = entryPattern.exec(keyText))) answers.set(Number(match[1]), match[2].trim());
  return { sourceText: text.slice(0, heading.index).trim(), answers };
}

function buildStructuredFallback({
  sourceText = "",
  title = "",
  testType = "Coding",
  language = "Python",
  questionCount = 4
}) {
  const extractedKey = extractGlobalAnswerKey(sourceText);
  const blocks = splitQuestionBlocks(extractedKey.sourceText).slice(0, Math.max(1, questionCount));
  if (!blocks.length) {
    return null;
  }

  const questions = blocks.map((block, index) => {
    const format = inferFormatFromBlock(block.body, testType, block.section);
    const options = extractOptions(block.body, block.section, format);
    const starter = "";
    const points = extractPoints(block.body);
    const separated = splitPromptAndAnswer(block.body);
    const prompt = cleanQuestionLabel(separated.prompt);
    const answerGuide = separated.answerGuide || extractedKey.answers.get(index + 1) || "";

    return {
      id: `question-${index + 1}`,
      number: index + 1,
      format: options.length >= 2 ? "Multiple Choice" : format,
      title: cleanQuestionLabel(block.title) || `${title || "Imported Exam"} Question ${index + 1}`,
      section: block.section,
      prompt,
      points,
      options,
      starter,
      answerGuide
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
      starter: "",
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
  const structured = buildStructuredFallback({ sourceText, title, testType, language, questionCount });
  if (structured && structured.questions.length >= 1) {
    return {
      ...structured,
      questions: keepAssessmentQuestions(normalizeQuestions(structured.questions)).map((question, index) => ({ ...question, id: `question-${index + 1}`, number: index + 1 })),
      mode: "structured"
    };
  }

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
    "A numbered rule or procedure is not a question. Ignore introductions, permitted-material notes, timing information, conduct rules, login steps, submission procedures, and candidate declarations even when they use 1., 2., 3. numbering.",
    "Only import items that ask the student to produce an assessable answer or code response.",
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
      questions: keepAssessmentQuestions(normalizeQuestions(parsed.questions)),
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

