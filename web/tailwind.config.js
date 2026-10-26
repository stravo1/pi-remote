import preset, { content } from "frappe-ui/tailwind";

export default {
  presets: [preset],
  content: [...content, "./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      fontFamily: { mono: ['"JetBrains Mono Variable"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
};
