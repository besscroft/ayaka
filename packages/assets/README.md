# @ayaka/assets

Shared static assets used by the Ayaka desktop client and official website.

## Animated emotions

Put the animated SVG files in `emotions/`. Use stable, lowercase IDs for file
names, for example:

```text
emotions/
├─ calm.svg
├─ focused.svg
└─ surprised.svg
```

Import an asset from either Vite application as a URL:

```ts
import calmUrl from "@ayaka/assets/emotions/calm.svg";
```

Keep the emotion ID (`calm`, `focused`, and so on) as the application value;
do not persist the generated URL in messages or other business data.
