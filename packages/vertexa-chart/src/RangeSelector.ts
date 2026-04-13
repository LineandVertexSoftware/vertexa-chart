import type { ResolvedRangeSelector, ResolvedChartTheme } from "./chart-utils.js";
import type { RangeSelectorPreset } from "./types.js";

/**
 * Row of preset range buttons (e.g. "1h", "24h", "7d", "All").
 * Positioned absolutely inside the chart container.
 */
export class RangeSelector {
  private el: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private activeLabel: string | null = null;
  private onPresetSelect: (preset: RangeSelectorPreset) => void;

  constructor(
    container: HTMLElement,
    private config: ResolvedRangeSelector,
    theme: ResolvedChartTheme,
    onPresetSelect: (preset: RangeSelectorPreset) => void
  ) {
    this.onPresetSelect = onPresetSelect;

    this.el = document.createElement("div");
    this.el.className = "vx-range-selector";
    Object.assign(this.el.style, {
      position: "absolute",
      display: "flex",
      gap: "4px",
      zIndex: "10",
      ...positionStyle(config.position)
    });

    for (const preset of config.presets) {
      const btn = document.createElement("button");
      btn.className = "vx-range-preset";
      btn.textContent = preset.label;
      btn.setAttribute("aria-label", `Show ${preset.label} range`);
      Object.assign(btn.style, {
        cursor: "pointer",
        border: `1px solid ${theme.colors.axis}`,
        borderRadius: "4px",
        background: theme.colors.background,
        color: theme.colors.text,
        fontFamily: theme.fonts.family,
        fontSize: `${Math.max(10, theme.fonts.sizePx - 2)}px`,
        padding: "2px 8px",
        lineHeight: "1.4",
        transition: "background 0.15s, color 0.15s"
      });
      btn.addEventListener("click", () => {
        this.setActivePreset(preset.label);
        this.onPresetSelect(preset);
      });
      this.buttons.push(btn);
      this.el.appendChild(btn);
    }

    container.appendChild(this.el);
  }

  setActivePreset(label: string | null) {
    this.activeLabel = label;
    for (const btn of this.buttons) {
      const isActive = btn.textContent === label;
      btn.style.fontWeight = isActive ? "700" : "400";
      btn.style.opacity = isActive ? "1" : "0.7";
    }
  }

  clearActive() {
    this.setActivePreset(null);
  }

  destroy() {
    this.el.remove();
    this.buttons = [];
  }
}

function positionStyle(position: string): Record<string, string> {
  switch (position) {
    case "top-left":
      return { top: "6px", left: "60px" };
    case "top-right":
      return { top: "6px", right: "6px" };
    case "bottom-left":
      return { bottom: "6px", left: "60px" };
    case "bottom-right":
      return { bottom: "6px", right: "6px" };
    default:
      return { top: "6px", left: "60px" };
  }
}
