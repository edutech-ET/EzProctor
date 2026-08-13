function normalizedFields(value = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), fieldValue])
  );
}

function cleanAnswer(value = "") {
  return String(value)
    .replace(/^\s*(?:model\s+answer|suggested\s+answer|correct\s+answer|answer|solution|marking\s+guide|rubric)\s*[:\-]\s*/i, "")
    .trim();
}

function entryFromObject(value = {}, index = 0) {
  const fields = normalizedFields(value);
  const answerGuide = cleanAnswer(
    fields.answerguide || fields.modelanswer || fields.suggestedanswer || fields.correctanswer ||
    fields.answerkey || fields.answer || fields.solution || fields.markingguide || fields.rubric || ""
  );
  return {
    sourceIndex: index,
    questionId: String(fields.questionid || fields.id || "").trim(),
    questionNumber: Number(fields.questionnumber || fields.number || fields.questionno || fields.no || 0) || null,
    title: String(fields.questiontitle || fields.title || fields.question || "").trim(),
    answerGuide
  };
}

function parseCsvRows(text = "") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseTextEntries(sourceText = "") {
  const text = String(sourceText).replace(/\r/g, "").trim();
  const marker = /^\s*(?:(Question|Q)\s*)?(\d+)\s*(?:[\).:\-])?\s*(.*)$/gim;
  const matches = [...text.matchAll(marker)];
  return matches.map((match, index) => {
    const hasQuestionPrefix = Boolean(match[1]);
    const tail = String(match[3] || "").trim();
    const blockEnd = matches[index + 1]?.index ?? text.length;
    const body = text.slice(match.index + match[0].length, blockEnd).trim();
    const labeledTail = /^(?:model\s+answer|suggested\s+answer|correct\s+answer|answer|solution|marking\s+guide|rubric)\s*[:\-]/i.test(tail);
    let title = "";
    let answerGuide = "";

    if (hasQuestionPrefix && !labeledTail) {
      title = tail;
      answerGuide = cleanAnswer(body);
    } else {
      answerGuide = cleanAnswer([tail, body].filter(Boolean).join("\n"));
    }

    return { sourceIndex: index, questionId: "", questionNumber: Number(match[2]), title, answerGuide };
  }).filter((entry) => entry.answerGuide);
}

function parseModelAnswers({ fileName = "", sourceText = "" }) {
  const lowerName = String(fileName).toLowerCase();
  let entries;
  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(sourceText);
    const values = Array.isArray(parsed) ? parsed : parsed.answers || parsed.modelAnswers;
    if (!Array.isArray(values)) throw new Error("JSON requires an answers or modelAnswers array.");
    entries = values.map(entryFromObject);
  } else if (lowerName.endsWith(".csv")) {
    const rows = parseCsvRows(sourceText);
    if (rows.length < 2) throw new Error("CSV requires a header row and at least one model answer.");
    const headers = rows[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
    entries = rows.slice(1).map((row, index) => entryFromObject(
      Object.fromEntries(headers.map((header, column) => [header, row[column] || ""])),
      index
    ));
  } else {
    entries = parseTextEntries(sourceText);
  }
  const usable = entries.filter((entry) => entry.answerGuide);
  if (!usable.length) throw new Error("No model answers were detected. Label entries by question number, such as '1. Answer text'.");
  return usable;
}

function titleTokens(value = "") {
  const ignored = new Set(["question", "write", "explain", "describe", "create", "program", "using", "with", "from", "that", "this", "your"]);
  return new Set(String(value).toLowerCase().replace(/[^a-z0-9+#]+/g, " ").split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token)));
}

function titleSimilarity(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / new Set([...a, ...b]).size;
}

function mapModelAnswers(exam, entries) {
  const questions = Array.isArray(exam?.questions) ? exam.questions : [];
  const usedQuestionIds = new Set();
  const matches = [];
  const unmatched = [];

  entries.forEach((entry) => {
    let question = entry.questionId ? questions.find((item) => item.id === entry.questionId) : null;
    let method = question ? "Question ID" : "";
    let confidence = question ? "Exact" : "";

    if (!question && entry.questionNumber && questions[entry.questionNumber - 1]) {
      question = questions[entry.questionNumber - 1];
      method = "Question number";
      confidence = "Exact";
    }

    if (!question && entry.title) {
      const ranked = questions
        .filter((item) => !usedQuestionIds.has(item.id))
        .map((item) => ({ item, score: titleSimilarity(entry.title, `${item.title} ${item.prompt}`) }))
        .sort((left, right) => right.score - left.score);
      if (ranked[0]?.score >= 0.45) {
        question = ranked[0].item;
        method = "Title similarity";
        confidence = ranked[0].score >= 0.7 ? "High" : "Review";
      }
    }

    if (!question || usedQuestionIds.has(question.id)) {
      unmatched.push({ ...entry, reason: question ? "Another answer already maps to this question." : "No matching exam question was found." });
      return;
    }

    usedQuestionIds.add(question.id);
    matches.push({
      sourceIndex: entry.sourceIndex,
      sourceLabel: entry.questionNumber ? `Question ${entry.questionNumber}` : entry.title || `Answer ${entry.sourceIndex + 1}`,
      questionId: question.id,
      questionNumber: questions.indexOf(question) + 1,
      questionTitle: question.title,
      answerGuide: entry.answerGuide,
      method,
      confidence
    });
  });

  return { matches, unmatched, totalEntries: entries.length, totalQuestions: questions.length };
}

module.exports = { mapModelAnswers, parseModelAnswers };
