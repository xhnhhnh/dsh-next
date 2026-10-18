# Third-party components

NEXT is an independent, unofficial DeepSeek Harness plugin, distributed under
the MIT license in `LICENSE`. DeepSeek and other product names belong to their
respective owners; this project does not imply endorsement.

- DeepSeek Harness public plugin interfaces (`@deepseek-ai/*` peer dependencies):
  provided by the installed host; [upstream source and license](https://github.com/deepseek-ai/deepseek-harness).
- Zod: MIT, [upstream source and license](https://github.com/colinhacks/zod).
- Optional development tools React, Vite, and Playwright are resolved from the
  developer's environment and are not bundled into the plugin archive. Their
  own licenses apply.

The execution guidance takes inspiration from the author's separate Adaptive
Mode work. This repository does not bundle Adaptive Mode or its presets.
