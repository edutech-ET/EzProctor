const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const demoVideo = document.querySelector("[data-demo-video]");
const demoTitle = document.querySelector("[data-demo-title]");
const demoCopy = document.querySelector("[data-demo-copy]");

window.addEventListener("scroll", () => {
  header?.classList.toggle("scrolled", window.scrollY > 30);
}, { passive: true });

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navigation?.classList.toggle("open", !isOpen);
});

navigation?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    navigation.classList.remove("open");
  });
});

document.querySelectorAll(".demo-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (!demoVideo) return;

    document.querySelectorAll(".demo-tab").forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });

    demoVideo.pause();
    demoVideo.poster = `./assets/${tab.dataset.poster}`;
    demoVideo.src = `./media/${tab.dataset.video}`;
    demoVideo.load();
    demoTitle.textContent = tab.dataset.title;
    demoCopy.textContent = tab.dataset.copy;
  });
});

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("visible");
    observer.unobserve(entry.target);
  });
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
