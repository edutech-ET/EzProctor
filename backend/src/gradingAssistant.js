function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9+#&]+/g, " ").replace(/\s+/g, " ").trim();
}

function meaningfulTokens(value = "") {
  const ignored = new Set(["the", "and", "that", "with", "from", "this", "have", "into", "your", "should", "will", "for", "are", "was", "were", "but", "not", "you", "its", "can", "use", "using"]);
  return [...new Set(normalizeText(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token)))];
}

function answerContent(answer = {}) {
  const files = Object.entries(answer.files || {}).map(([name, content]) => `${name}\n${content}`).join("\n");
  return [answer.answerText, files].filter(Boolean).join("\n");
}

function multipleChoiceSuggestion(question, answer) {
  const guide = String(question.answerGuide || "").trim();
  const selectedIndex = Number(answer.selectedOption);
  const selectedText = question.options?.[selectedIndex] || "";
  const letterMatch = guide.match(/^(?:answer\s*[:\-]?\s*)?([A-H])(?:[\).:\s]|$)/i);
  const expectedIndex = letterMatch ? letterMatch[1].toUpperCase().charCodeAt(0) - 65 : -1;
  const correct = expectedIndex >= 0
    ? selectedIndex === expectedIndex
    : normalizeText(guide).includes(normalizeText(selectedText)) && Boolean(selectedText);
  return {
    suggestedScore: correct ? Number(question.points || 0) : 0,
    confidence: guide ? "High" : "Low",
    matchedPoints: correct ? [selectedText] : [],
    missingPoints: correct ? [] : [guide || "No correct answer was imported."],
    feedback: correct
      ? "The selected answer matches the imported answer key."
      : guide ? `The selected answer does not match the imported key (${guide}).` : "Add a correct answer to the marking guide before relying on this suggestion."
  };
}

function rubricSuggestion(question, answer) {
  const guide = String(question.answerGuide || "").trim();
  const response = answerContent(answer);
  if (!guide) {
    return { suggestedScore: null, confidence: "Low", matchedPoints: [], missingPoints: ["No model answer or marking guide imported."], feedback: "Add a model answer or marking guide to enable pre-grading." };
  }
  if (!response.trim()) {
    return { suggestedScore: 0, confidence: "High", matchedPoints: [], missingPoints: [guide], feedback: "No written or coding response was found for this question." };
  }

  const guideTokens = meaningfulTokens(guide);
  const responseText = normalizeText(response);
  const matched = guideTokens.filter((token) => responseText.includes(token));
  const missing = guideTokens.filter((token) => !responseText.includes(token));
  let ratio = guideTokens.length ? matched.length / guideTokens.length : 0;
  if (answer.result?.ok) ratio = Math.min(1, ratio + 0.15);
  const points = Number(question.points || 0);
  const suggestedScore = Math.round(points * ratio * 2) / 2;
  const confidence = guideTokens.length >= 4 ? "Medium" : "Low";
  const feedbackParts = [
    matched.length ? `Evidence matched: ${matched.slice(0, 8).join(", ")}.` : "No clear marking-guide evidence was matched.",
    missing.length ? `Review missing or unclear points: ${missing.slice(0, 8).join(", ")}.` : "The response covers the imported key points.",
    answer.result?.ok ? "The latest code run completed successfully." : "Code execution did not provide successful runtime evidence."
  ];
  return { suggestedScore, confidence, matchedPoints: matched, missingPoints: missing, feedback: feedbackParts.join(" ") };
}

function suggestQuestionGrade(question, answer) {
  if (!answer?.answered) {
    return { suggestedScore: 0, confidence: "High", matchedPoints: [], missingPoints: ["No answer submitted."], feedback: "The student has not answered this question." };
  }
  return question.format === "Multiple Choice"
    ? multipleChoiceSuggestion(question, answer)
    : rubricSuggestion(question, answer);
}

module.exports = { suggestQuestionGrade };
