import type {
  ChartExportCsvPointsOptions,
  ChartExportPngOptions,
  ChartExportSvgOptions
} from "./types.js";
import type { ResolvedChartA11y, ResolvedChartTheme, ResolvedChartToolbar } from "./chart-utils.js";
import { isToolbarExportFormat, sanitizeFilenamePart } from "./chart-utils.js";

export interface ToolbarCallbacks {
  exportPng(opts: ChartExportPngOptions): Promise<Blob>;
  exportSvg(opts: ChartExportSvgOptions): Promise<Blob>;
  exportCsvPoints(opts: ChartExportCsvPointsOptions): Blob;
  setSize(width: number, height: number): void;
  getSize(): { width: number; height: number };
}

export class Toolbar {
  private container: HTMLElement;
  private config: ResolvedChartToolbar;
  private theme: ResolvedChartTheme;
  private a11y: ResolvedChartA11y;
  private callbacks: ToolbarCallbacks;

  private toolbarEl: HTMLDivElement | null = null;
  private exportWrap: HTMLDivElement | null = null;
  private exportMenu: HTMLDivElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private fullscreenButton: HTMLButtonElement | null = null;

  private exportOpen = false;
  private exportBusy = false;
  private preFullscreenSize: { width: number; height: number } | null = null;

  // Bound handlers for addEventListener / removeEventListener
  private handleExportToggle = (event: MouseEvent) => this.onExportToggle(event);
  private handleExportMenuClick = (event: MouseEvent) => { void this.onExportMenuClick(event); };
  private handleFullscreenClick = () => { void this.onFullscreenClick(); };
  private handleDocumentPointerDown = (event: PointerEvent) => this.onDocumentPointerDown(event);
  private handleDocumentKeyDown = (event: KeyboardEvent) => this.onDocumentKeyDown(event);
  private handleFullscreenChange = () => this.onFullscreenChange();
  private handleWindowResize = () => this.onWindowResize();

  constructor(
    container: HTMLElement,
    config: ResolvedChartToolbar,
    theme: ResolvedChartTheme,
    a11y: ResolvedChartA11y,
    callbacks: ToolbarCallbacks
  ) {
    this.container = container;
    this.config = config;
    this.theme = theme;
    this.a11y = a11y;
    this.callbacks = callbacks;
    this.mount();
  }

  private mount(): void {
    if (!this.config.show) return;
    const enableExport = this.config.export && this.config.exportFormats.length > 0;
    const enableFullscreen = this.config.fullscreen;
    if (!enableExport && !enableFullscreen) return;

    const toolbar = document.createElement("div");
    this.toolbarEl = toolbar;
    toolbar.className = "chart-toolbar";
    Object.assign(toolbar.style, {
      position: "absolute",
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px",
      borderRadius: "10px",
      border: `1px solid ${this.theme.axis.color}`,
      background: this.a11y.highContrast ? "#000000" : "rgba(255,255,255,0.9)",
      boxShadow: this.a11y.highContrast ? "none" : "0 6px 16px rgba(15,23,42,0.12)",
      pointerEvents: "auto",
      zIndex: "1100"
    });

    switch (this.config.position) {
      case "top-left":
        toolbar.style.top = "10px";
        toolbar.style.left = "10px";
        break;
      case "bottom-right":
        toolbar.style.right = "10px";
        toolbar.style.bottom = "10px";
        break;
      case "bottom-left":
        toolbar.style.left = "10px";
        toolbar.style.bottom = "10px";
        break;
      case "top-right":
      default:
        toolbar.style.top = "10px";
        toolbar.style.right = "10px";
        break;
    }

    if (enableFullscreen) {
      const button = this.createButton("Full", "Enter full screen");
      this.fullscreenButton = button;
      button.addEventListener("click", this.handleFullscreenClick);
      toolbar.appendChild(button);
    }

    if (enableExport) {
      const wrap = document.createElement("div");
      this.exportWrap = wrap;
      Object.assign(wrap.style, {
        position: "relative",
        display: "inline-flex",
        alignItems: "center"
      });

      const trigger = this.createButton("Export", "Export chart");
      this.exportButton = trigger;
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", this.handleExportToggle);
      wrap.appendChild(trigger);

      const menu = document.createElement("div");
      this.exportMenu = menu;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Export options");
      Object.assign(menu.style, {
        position: "absolute",
        top: "calc(100% + 6px)",
        right: "0",
        minWidth: "100px",
        display: "none",
        flexDirection: "column",
        gap: "4px",
        padding: "6px",
        borderRadius: "8px",
        border: `1px solid ${this.theme.axis.color}`,
        background: this.a11y.highContrast ? "#000000" : "#ffffff",
        boxShadow: this.a11y.highContrast ? "none" : "0 10px 22px rgba(15,23,42,0.16)"
      });

      for (const format of this.config.exportFormats) {
        const item = this.createButton(format.toUpperCase(), `Export ${format.toUpperCase()}`);
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.dataset.vxExportFormat = format;
        item.style.width = "100%";
        item.style.justifyContent = "flex-start";
        item.style.padding = "4px 8px";
        item.style.borderRadius = "6px";
        item.style.fontSize = "11px";
        menu.appendChild(item);
      }

      menu.addEventListener("click", this.handleExportMenuClick);
      wrap.appendChild(menu);
      toolbar.appendChild(wrap);
    }

    this.container.appendChild(toolbar);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown);
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    window.addEventListener("resize", this.handleWindowResize);

    this.setExportMenuOpen(false);
    this.syncFullscreenButton(document.fullscreenElement === this.container);
  }

  private createButton(label: string, title: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    Object.assign(button.style, {
      appearance: "none",
      border: `1px solid ${this.theme.axis.color}`,
      background: this.a11y.highContrast ? "#000000" : "#ffffff",
      color: this.theme.colors.text,
      borderRadius: "8px",
      fontFamily: this.theme.fonts.family,
      fontSize: "12px",
      fontWeight: "600",
      lineHeight: "1",
      minHeight: "28px",
      padding: "6px 9px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    });
    return button;
  }

  private setExportMenuOpen(open: boolean): void {
    this.exportOpen = open;
    if (this.exportMenu) {
      this.exportMenu.style.display = open ? "flex" : "none";
    }
    if (this.exportButton) {
      this.exportButton.setAttribute("aria-expanded", String(open));
    }
  }

  private onExportToggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.exportBusy || !this.exportMenu) return;
    this.setExportMenuOpen(!this.exportOpen);
  }

  private async onExportMenuClick(event: MouseEvent): Promise<void> {
    if (this.exportBusy) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>("button[data-vx-export-format]");
    if (!button) return;
    const format = button.dataset.vxExportFormat;
    if (!isToolbarExportFormat(format)) return;

    this.exportBusy = true;
    if (this.exportButton) this.exportButton.disabled = true;
    this.exportMenu?.querySelectorAll<HTMLButtonElement>("button[data-vx-export-format]").forEach((node) => {
      node.disabled = true;
    });

    try {
      const timestamp = Date.now();
      if (format === "png") {
        const blob = await this.callbacks.exportPng({ pixelRatio: this.config.exportPixelRatio });
        this.downloadBlob(blob, `${sanitizeFilenamePart(this.config.exportFilename)}-${timestamp}.png`);
      } else if (format === "svg") {
        const blob = await this.callbacks.exportSvg({ pixelRatio: this.config.exportPixelRatio });
        this.downloadBlob(blob, `${sanitizeFilenamePart(this.config.exportFilename)}-${timestamp}.svg`);
      } else {
        const blob = this.callbacks.exportCsvPoints({});
        this.downloadBlob(blob, `${sanitizeFilenamePart(this.config.exportFilename)}-points-${timestamp}.csv`);
      }
    } catch (error) {
      console.error("[vertexa-chart] Toolbar export failed.", error);
    } finally {
      this.exportBusy = false;
      if (this.exportButton) this.exportButton.disabled = false;
      this.exportMenu?.querySelectorAll<HTMLButtonElement>("button[data-vx-export-format]").forEach((node) => {
        node.disabled = false;
      });
      this.setExportMenuOpen(false);
    }
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private async onFullscreenClick(): Promise<void> {
    if (!this.fullscreenButton) return;
    try {
      if (document.fullscreenElement === this.container) {
        await document.exitFullscreen();
        return;
      }
      if (!this.preFullscreenSize) {
        const { width, height } = this.callbacks.getSize();
        this.preFullscreenSize = { width, height };
      }
      if (document.fullscreenElement && document.fullscreenElement !== this.container) {
        await document.exitFullscreen();
      }
      await this.container.requestFullscreen();
    } catch (error) {
      this.preFullscreenSize = null;
      console.error("[vertexa-chart] Fullscreen toggle failed.", error);
    }
  }

  private onDocumentPointerDown(event: PointerEvent): void {
    if (!this.exportOpen || !this.exportWrap) return;
    const target = event.target;
    if (target instanceof Node && this.exportWrap.contains(target)) return;
    this.setExportMenuOpen(false);
  }

  private onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.setExportMenuOpen(false);
    }
  }

  private onFullscreenChange(): void {
    const active = document.fullscreenElement === this.container;
    this.syncFullscreenButton(active);
    if (active) {
      if (!this.preFullscreenSize) {
        const { width, height } = this.callbacks.getSize();
        this.preFullscreenSize = { width, height };
      }
      this.resizeToFullscreenViewport();
      return;
    }
    const previousSize = this.preFullscreenSize;
    this.preFullscreenSize = null;
    if (!previousSize) return;
    const { width, height } = this.callbacks.getSize();
    if (previousSize.width !== width || previousSize.height !== height) {
      this.callbacks.setSize(previousSize.width, previousSize.height);
    }
  }

  private onWindowResize(): void {
    if (document.fullscreenElement !== this.container) return;
    this.resizeToFullscreenViewport();
  }

  private resizeToFullscreenViewport(): void {
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(240, window.innerHeight);
    const current = this.callbacks.getSize();
    if (width === current.width && height === current.height) return;
    this.callbacks.setSize(width, height);
  }

  private syncFullscreenButton(active: boolean): void {
    if (!this.fullscreenButton) return;
    this.fullscreenButton.textContent = active ? "Exit" : "Full";
    this.fullscreenButton.title = active ? "Exit full screen" : "Enter full screen";
    this.fullscreenButton.setAttribute("aria-label", active ? "Exit full screen" : "Enter full screen");
    this.fullscreenButton.setAttribute("aria-pressed", String(active));
    this.fullscreenButton.style.borderColor = active ? this.theme.colors.axis : this.theme.axis.color;
    this.fullscreenButton.style.background = active ? this.theme.colors.axis : (this.a11y.highContrast ? "#000000" : "#ffffff");
    this.fullscreenButton.style.color = active ? this.theme.colors.background : this.theme.colors.text;
  }

  cleanup(): void {
    this.exportOpen = false;
    this.exportBusy = false;
    this.preFullscreenSize = null;
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown);
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    window.removeEventListener("resize", this.handleWindowResize);
    this.exportButton?.removeEventListener("click", this.handleExportToggle);
    this.exportMenu?.removeEventListener("click", this.handleExportMenuClick);
    this.fullscreenButton?.removeEventListener("click", this.handleFullscreenClick);
    this.toolbarEl = null;
    this.exportWrap = null;
    this.exportMenu = null;
    this.exportButton = null;
    this.fullscreenButton = null;
  }
}
