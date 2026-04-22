const revealTargets = Array.from(document.querySelectorAll(".section, .snapshot, .role-card, .stack-grid article"));
revealTargets.forEach((node) => node.classList.add("reveal"));

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

revealTargets.forEach((node) => observer.observe(node));

