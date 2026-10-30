/** Each project owns its gallery state, including keyboard navigation and a native dialog. */
class WorkGallery extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = "true";

    const tabs = Array.from(this.querySelectorAll<HTMLAnchorElement>("[data-gallery-tab]"));
    const panels = Array.from(this.querySelectorAll<HTMLElement>("[data-gallery-panel]"));
    const tabList = this.querySelector<HTMLElement>(".gallery-tabs");
    const caption = this.querySelector<HTMLElement>(".gallery-caption");
    const expand = this.querySelector<HTMLAnchorElement>("[data-open-gallery]");
    const dialog = this.querySelector<HTMLDialogElement>("dialog");
    const dialogImage = this.querySelector<HTMLImageElement>(".dialog-image");
    const dialogTitle = this.querySelector<HTMLElement>(".dialog-title");
    if (!tabs.length || !panels.length || !dialog || !dialogImage) return;

    let selected = 0;
    tabList?.setAttribute("role", "tablist");
    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panels[index].id);
      panels[index].setAttribute("role", "tabpanel");
      panels[index].setAttribute("aria-labelledby", tab.id);
      panels[index].querySelector("a")?.setAttribute("aria-haspopup", "dialog");
    });
    expand?.setAttribute("aria-haspopup", "dialog");

    const select = (index: number) => {
      selected = (index + tabs.length) % tabs.length;
      tabs.forEach((tab, i) => {
        tab.classList.toggle("is-active", i === selected);
        tab.setAttribute("aria-selected", String(i === selected));
        tab.tabIndex = i === selected ? 0 : -1;
        panels[i].hidden = i !== selected;
        panels[i].classList.toggle("is-entering", i === selected);
      });
      if (caption) caption.textContent = tabs[selected].dataset.description ?? "";
      if (expand) expand.href = tabs[selected].href;
      const image = panels[selected].querySelector("img");
      if (image) {
        dialogImage.src = image.src;
        dialogImage.alt = image.alt;
      }
      if (dialogTitle) dialogTitle.textContent = tabs[selected].textContent;
    };
    select(0);

    const open = (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      dialog.showModal();
    };
    expand?.addEventListener("click", open);
    panels.forEach(panel => panel.querySelector("a")?.addEventListener("click", open));
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        select(index);
      });
      tab.addEventListener("keydown", event => {
        let next: number;
        if (event.key === "ArrowRight") next = selected + 1;
        else if (event.key === "ArrowLeft") next = selected - 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(next);
        tabs[selected].focus();
      });
    });
    this.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
    this.querySelector("[data-dialog-prev]")?.addEventListener("click", () => select(selected - 1));
    this.querySelector("[data-dialog-next]")?.addEventListener("click", () => select(selected + 1));
    dialog.addEventListener("keydown", event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        select(selected + (event.key === "ArrowRight" ? 1 : -1));
      }
    });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    // Close before an Astro route transition so the browser releases its modal focus state.
    document.addEventListener("astro:before-swap", () => dialog.close(), { once: true });
  }
}

if (!customElements.get("work-gallery")) customElements.define("work-gallery", WorkGallery);
