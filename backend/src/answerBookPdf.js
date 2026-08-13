const PDFDocument = require("pdfkit");

function safeText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");
}

function answerStatus(question) {
  const answer = question.answer;
  if (!answer) return "Unanswered";
  const coding = /coding|debug|frontend/i.test(String(question.format || ""));
  const hasOfficialAnswer = coding
    ? Object.values(answer.files || {}).some((content) => String(content).trim())
    : Boolean(String(answer.answerText || "").trim() || String(answer.selectedOption || "") !== "");
  return hasOfficialAnswer ? "Answered" : "Unanswered";
}

function createAnswerBookPdf(groups, title, stream) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, right: 48, bottom: 58, left: 48 }, bufferPages: true, info: { Title: safeText(title), Author: "EzProctor Exam" } });
  doc.pipe(stream);

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ensureSpace = (height = 80) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const heading = (text, size = 16, color = "#173a2d") => {
    ensureSpace(size + 18);
    doc.font("Helvetica-Bold").fontSize(size).fillColor(color).text(safeText(text), { width });
  };
  const label = (text) => doc.moveDown(0.35).font("Helvetica-Bold").fontSize(8).fillColor("#9a6537").text(safeText(text).toUpperCase(), { characterSpacing: 0.7 });
  const body = (text, options = {}) => doc.font(options.mono ? "Courier" : "Helvetica").fontSize(options.mono ? 8.5 : 10).fillColor(options.color || "#26352d").text(safeText(text || ""), { width, lineGap: options.mono ? 1.5 : 2.5 });
  const rule = () => doc.moveDown(0.45).strokeColor("#d6ded8").lineWidth(0.7).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().moveDown(0.6);

  doc.rect(0, 0, doc.page.width, 175).fill("#173a2d");
  doc.fillColor("#8fe0bd").font("Helvetica-Bold").fontSize(10).text("EZPROCTOR EXAM", 48, 55, { characterSpacing: 1.4 });
  doc.fillColor("#ffffff").fontSize(25);
  const titleText = safeText(title);
  const titleHeight = doc.heightOfString(titleText, { width });
  doc.text(titleText, 48, 78, { width });
  const subtitleY = Math.min(150, 78 + titleHeight + 8);
  doc.fillColor("#d9ece2").font("Helvetica").fontSize(10).text(`Complete student answer backup\nExported ${new Date().toLocaleString()}`, 48, subtitleY, { lineGap: 4 });
  doc.y = 205;

  for (const { session, exam, students } of groups) {
    ensureSpace(120);
    heading(session.sessionName, 19);
    body(`${exam?.title || session.examTitle} | ${exam?.language || session.language} | ${exam?.durationMinutes || session.durationMinutes} minutes`);
    body(`${students.length} student record${students.length === 1 ? "" : "s"} | Session status: ${session.status}`, { color: "#627069" });
    rule();

    if (!students.length) {
      body("No student records were found for this session.");
      continue;
    }

    for (const student of students) {
      doc.addPage();
      heading(`${student.fullName} (${student.studentNumber || student.studentId})`, 18);
      body(`Session: ${session.sessionName}`);
      body(`Submission: ${student.submittedAt ? new Date(student.submittedAt).toLocaleString() : "Not submitted"}`);
      body(`Status: ${student.gradeStatus} | Final score: ${student.finalScore ?? "Not graded"}`);
      rule();

      for (const question of student.questions) {
        ensureSpace(145);
        heading(`Question ${question.number} - ${question.title}`, 13, "#8a4a20");
        body(`${question.format} | ${question.points} marks | ${answerStatus(question)} | Awarded: ${question.answer?.score ?? "Not graded"}`);
        label("Question");
        body(question.prompt);
        const answer = question.answer;
        if (!answer) {
          label("Official answer");
          body("No answer recorded.", { color: "#7b8680" });
          rule();
          continue;
        }

        if (answer.answerText) {
          label("Official written answer");
          body(answer.answerText);
        }
        if (String(answer.selectedOption || "") !== "") {
          const index = Number(answer.selectedOption);
          label("Official selected answer");
          body(`${String.fromCharCode(65 + index)}. ${question.options?.[index] || ""}`);
        }
        for (const [name, content] of Object.entries(answer.files || {})) {
          label(`Official file - ${name}`);
          body(content || "(empty file)", { mono: true });
        }
        if (answer.stdinText) {
          label("Test input");
          body(answer.stdinText, { mono: true });
        }
        if (answer.result) {
          label("Latest run output");
          body([answer.result.stdout, answer.result.stderr].filter(Boolean).join("\n") || "No output.", { mono: true });
        }
        const scratchEntries = Object.entries(answer.scratchFiles || {});
        if (scratchEntries.length) {
          label("Practice IDE evidence - not the official answer");
          for (const [name, content] of scratchEntries) {
            body(`${name}\n${content || "(empty file)"}`, { mono: true, color: "#59665f" });
          }
        }
        if (answer.feedback) {
          label("Educator feedback");
          body(answer.feedback);
        }
        rule();
      }

      if (student.teacherFeedback) {
        heading("Overall educator feedback", 13);
        body(student.teacherFeedback);
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#758078").text(
      `EzProctor Exam answer backup | Page ${index + 1} of ${range.count}`,
      doc.page.margins.left,
      doc.page.height - 35,
      { width, align: "center", lineBreak: false }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }
  doc.end();
}

module.exports = { createAnswerBookPdf };
