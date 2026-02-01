---
trigger: always_on
---

# MCP Bridge Development Rules

## 1. Critical Workflow
- **Reload Required**: Any changes to `main.js`, `package.json`, `scene-script.js`, or `panel/` MUST be followed by reloading the plugin ("Reload Package") or restarting the editor. Hot reload does not apply to main process scripts.
- **Test-Driven**: Always create a standalone test script in `test/` (e.g., `test/test_feature.js`) for new features. Tests must direct HTTP requests to verify functionality.

## 2. Architecture & IPC
- **Process Isolation**: 
    - `scene-script.js` (Renderer Process) CANNOT access `Editor.assetdb` or `Editor.FileSystem`.
    - `main.js` (Main Process) CANNOT access `cc` (Cocos Engine) directly.
    - **Rule**: Resolve asset paths (URL -> UUID) in `main.js` using `Editor.assetdb.urlToUuid()` BEFORE calling `callSceneScript`. Pass UUIDs to the scene script.
- **Logging**:
    - Use `addLog(type, message)` in `main.js` instead of `console.log` to ensure logs are captured by the `read_console` tool and visible in the panel.

## 3. Coding Standards
- **Safe Editing**: Be extremely careful when editing `main.js` to avoid duplicate code blocks or closing braces. Use `view_file` to verify context.
- **Undo/Redo**: 
    - All scene-modifying actions (node transform, property changes) SHOULD support Undo/Redo.
    - Use `Editor.Ipc.sendToMain('scene:undo-record', ...)` if modifying via scene script, or wrap operations in `manage_undo` groups.

## 4. Feature Specifics
- **Particle Systems (VFX)**:
    - Always set `particleSystem.custom = true` when modifying properties via script.
    - Ensure a valid `texture` is set (or load a default one like `db://internal/image/default_sprite_splash.png`) to avoid invisible particles.
- **Resource Loading**:
    - Built-in assets (`db://internal/...`) may need specific extensions (`.png`, `.jpg`) depending on the editor version. Try multiple paths if lookup fails.
