export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        // 深色配色对齐 OneWork 暗色板（--ow-* 变量）：editor-bg #181818 / text #d1d5db /
        // text-muted #9ca3af / shell-bg #0e0e10 / toolbar-bg #18181a / pane-muted #1f1f21
        canvas: {
            background: "#181818",
            dot: "rgba(209,213,219,.18)",
            line: "rgba(209,213,219,.08)",
            selectionStroke: "#e5e7eb",
            selectionFill: "rgba(229,231,235,.10)",
        },
        node: {
            label: "#9ca3af",
            fill: "#1c1c1f",
            panel: "#161618",
            stroke: "#2e2e32",
            activeStroke: "#e5e7eb",
            placeholder: "#6b7280",
            text: "#d1d5db",
            muted: "#9ca3af",
            faint: "#6b7280",
        },
        toolbar: {
            panel: "rgba(24,24,26,.96)",
            border: "#2e2e32",
            item: "#9ca3af",
            itemHover: "#2f2f33",
            activeBg: "#3a3a3e",
            activeText: "#e5e7eb",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
