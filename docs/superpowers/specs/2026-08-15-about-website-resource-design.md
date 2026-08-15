# About Settings Website Resource Update

## Summary

Adjust the existing About settings resource actions so the product link is presented as the official website. Remove the documentation and issue-feedback actions while preserving the existing update-log action, layout, external-link behavior, and current user changes to the Ayaka branding and website URL.

## Scope

- Keep `ABOUT_RESOURCES` data-driven, but define only the `repository` resource.
- Keep the existing website URL: `https://ai.zzzvoid.com/`.
- Change the Chinese label from “项目主页” to “官网”.
- Change the English label from “Project repository” to “Official website”.
- Remove the documentation and issue-feedback resource identifiers, URLs, icons, and translations that are no longer rendered.
- Update the focused resource-definition test to assert the single official website entry.

## Design And Behavior

The About page continues to render the update-log button followed by the resources returned from `ABOUT_RESOURCES`. With one resource in the list, users see exactly two actions: “更新日志” and “官网” in Chinese, or “Update log” and “Official website” in English. The website opens through the existing `window.open` flow; no IPC, routing, dialog, or styling changes are needed.

## Verification

- Confirm the resource array contains only the website entry and retains the existing URL.
- Confirm Chinese and English resource labels resolve to the requested copy.
- Run the focused About resource test, then the repository checks required by the project when practical.
- Review the final diff to ensure unrelated pre-existing working-tree changes remain untouched.

## Non-Goals

- Do not change the About page structure, update checking, product description, application version handling, or external-link mechanism.
- Do not remove unrelated documentation or feedback strings used elsewhere in the application.
