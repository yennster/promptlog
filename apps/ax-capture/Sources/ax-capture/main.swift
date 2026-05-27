import AppKit
import ApplicationServices
import Foundation

// JSON protocol: one request per line on stdin, one response per line on stdout.
// Each response is a JSON object with at least "ok": bool.

struct AnyEncodable: Encodable {
    let value: Any
    init(_ value: Any) { self.value = value }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Bool: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]: try c.encode(v.map(AnyEncodable.init))
        case let v as [String: Any]: try c.encode(v.mapValues(AnyEncodable.init))
        case is NSNull: try c.encodeNil()
        default: try c.encodeNil()
        }
    }
}

func writeJSON(_ obj: [String: Any]) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    do {
        let data = try encoder.encode(AnyEncodable(obj))
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    } catch {
        let fallback = "{\"ok\":false,\"error\":\"encode failed\"}\n"
        FileHandle.standardOutput.write(fallback.data(using: .utf8)!)
    }
}

// MARK: - AX helpers

func axIsTrusted(prompt: Bool) -> Bool {
    let opts: [String: Any] = [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt
    ]
    return AXIsProcessTrustedWithOptions(opts as CFDictionary)
}

func runningApp(forBundleId bundleId: String) -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == bundleId }
}

// Chromium/Electron-based apps (Claude, ChatGPT, etc.) lazily expose their
// renderer accessibility tree only when an AT is "connected". Two things are
// required: (1) set AXManualAccessibility=true on the app element, (2)
// register an AXObserver on the app so Chromium believes a real AT is
// listening. Without the observer, the AX tree only contains the native shell.
private var awokenApps = [pid_t: AXObserver]()
func awakenAccessibility(_ app: AXUIElement, pid: pid_t) {
    if awokenApps[pid] != nil { return }
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

    // Register a no-op observer so Chromium plumbs through full AX content.
    var observer: AXObserver?
    let callback: AXObserverCallback = { _, _, _, _ in /* no-op */ }
    if AXObserverCreate(pid, callback, &observer) == .success, let obs = observer {
        CFRunLoopAddSource(
            CFRunLoopGetMain(),
            AXObserverGetRunLoopSource(obs),
            .defaultMode
        )
        // Subscribe to a couple of notifications. We don't actually handle
        // them; the registration itself is what flips Chromium's AX flag.
        for notif in [
            kAXFocusedUIElementChangedNotification,
            kAXValueChangedNotification,
            kAXSelectedTextChangedNotification,
        ] {
            AXObserverAddNotification(obs, app, notif as CFString, nil)
        }
        awokenApps[pid] = obs
    }
}

func axApp(forBundleId bundleId: String) -> AXUIElement? {
    guard let app = runningApp(forBundleId: bundleId) else { return nil }
    let el = AXUIElementCreateApplication(app.processIdentifier)
    awakenAccessibility(el, pid: app.processIdentifier)
    return el
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    let err = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    if err != .success { return nil }
    return value
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name) as? String
}

func childrenAttribute(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

// Walk descendant tree, calling visitor. Aborts when visitor returns false.
// `maxDepth` keeps this from running away on giant Electron trees.
func walk(_ element: AXUIElement, maxDepth: Int = 18, depth: Int = 0,
          visit: (AXUIElement, Int) -> Bool) {
    if depth > maxDepth { return }
    if !visit(element, depth) { return }
    for child in childrenAttribute(element) {
        walk(child, maxDepth: maxDepth, depth: depth + 1, visit: visit)
    }
}

// Find all elements whose role matches a predicate. Returns up to `limit`.
func findAll(_ root: AXUIElement,
             roles: Set<String>,
             limit: Int = 200) -> [AXUIElement] {
    var out: [AXUIElement] = []
    walk(root) { el, _ in
        if out.count >= limit { return false }
        if let role = stringAttribute(el, kAXRoleAttribute), roles.contains(role) {
            out.append(el)
        }
        return true
    }
    return out
}

// Collect all visible text content under an element. Concatenates AXValue +
// AXTitle + AXDescription of each descendant. Used to read assistant bubbles.
func collectText(_ root: AXUIElement, limit: Int = 64_000) -> String {
    var pieces: [String] = []
    var total = 0
    walk(root) { el, _ in
        if total >= limit { return false }
        
        // Skip interactive elements (buttons, popups, menus, checkboxes, radio buttons, switches)
        // and all their children to cleanly filter out UI chrome.
        if let role = stringAttribute(el, kAXRoleAttribute) {
            let skipRoles: Set<String> = [
                "AXButton",
                "AXPopUpButton",
                "AXMenuButton",
                "AXCheckBox",
                "AXRadioButton",
                "AXSwitch"
            ]
            if skipRoles.contains(role) {
                return false // Skip this element and its descendants
            }
        }
        
        for attr in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
            if let s = stringAttribute(el, attr), !s.isEmpty {
                pieces.append(s)
                total += s.count
                if total >= limit { return false }
            }
        }
        return true
    }
    return pieces.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Snapshot logic

// Heuristics that work across the four target apps (Electron/webview):
//   composer = the focused or largest AXTextArea (fallback to focused AXTextField).
//   conversation = the largest AXScrollArea / AXGroup that's a sibling/parent of the composer.
//   lastAssistant = the last large text region inside that conversation, EXCLUDING the composer.
// This avoids needing one bespoke selector per app while still being fast.

func areaOfSize(_ el: AXUIElement) -> Double {
    var sizeRef: AnyObject?
    if AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) != .success { return 0 }
    guard let v = sizeRef, CFGetTypeID(v) == AXValueGetTypeID() else { return 0 }
    var size = CGSize.zero
    AXValueGetValue(v as! AXValue, .cgSize, &size)
    return Double(size.width * size.height)
}

// Pick the main chat window from an app — largest AXWindow that's not a
// floating panel. We enumerate all windows (not just the focused one) so the
// daemon can read Claude/ChatGPT/etc. even while you're looking at the
// dashboard in your browser.
func mainWindow(_ app: AXUIElement) -> AXUIElement? {
    if let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement],
       !windows.isEmpty {
        return windows.max(by: { areaOfSize($0) < areaOfSize($1) })
    }
    if let focused = attribute(app, kAXFocusedWindowAttribute) {
        return (focused as! AXUIElement)
    }
    return nil
}

func composerElement(_ app: AXUIElement) -> AXUIElement? {
    // Chromium/Electron apps (Claude, ChatGPT, etc.) often hide their
    // contenteditable composer from kAXChildrenAttribute traversal — it only
    // surfaces via kAXFocusedUIElementAttribute. Prefer that path. The app's
    // *own* focused element survives even when another app is in the
    // foreground, so this still works while you watch the dashboard.
    if let focused = attribute(app, kAXFocusedUIElementAttribute) {
        let el = focused as! AXUIElement
        let role = stringAttribute(el, kAXRoleAttribute) ?? ""
        let desc = stringAttribute(el, kAXDescriptionAttribute) ?? ""
        let placeholder = stringAttribute(el, "AXPlaceholderValue") ?? ""
        if role == kAXTextAreaRole || role == kAXTextFieldRole
            || ["Prompt", "Message", "Ask anything"].contains(desc)
            || placeholder.lowercased().contains("message")
            || placeholder.lowercased().contains("ask")
        {
            return el
        }
    }
    // Fallback: largest AXTextArea/AXTextField reachable from the window
    // children. Works for non-Chromium apps.
    guard let window = mainWindow(app) else { return nil }
    let textAreas = findAll(window, roles: [kAXTextAreaRole, kAXTextFieldRole])
    return textAreas.max(by: { areaOfSize($0) < areaOfSize($1) })
}

func conversationRoot(_ app: AXUIElement) -> AXUIElement? {
    guard let window = mainWindow(app) else { return nil }
    let scrollAreas = findAll(window, roles: [kAXScrollAreaRole])
    if let largest = scrollAreas.max(by: { areaOfSize($0) < areaOfSize($1) }) {
        return largest
    }
    return window
}

// Last assistant message: the *last* large AXGroup / AXStaticText cluster
// inside the conversation root. Heuristic, but works well enough for Electron
// chat apps where each message is its own AXGroup.
//
// First pass: look for AXGroups whose AXDescription is one of a small set of
// known "assistant message" labels (Antigravity exposes "Agent response", for
// example). These give a clean, scoped subtree that doesn't include composer
// chrome.
//
// Second pass (fallback): the original heuristic — last AXGroup with >= 40
// chars of text. Used for apps like Claude desktop that don't label bubbles.
let ASSISTANT_LABELS: Set<String> = [
    "Agent response",   // Antigravity
    "Assistant message",
    "Assistant response",
]
let USER_LABELS: Set<String> = [
    "User message",     // Antigravity
    "Your message",
]

func findAllMatching(
    _ root: AXUIElement,
    limit: Int = 200,
    predicate: (AXUIElement) -> Bool
) -> [AXUIElement] {
    var out: [AXUIElement] = []
    walk(root) { el, _ in
        if out.count >= limit { return false }
        if predicate(el) { out.append(el) }
        return true
    }
    return out
}

func lastAssistantText(_ app: AXUIElement) -> String? {
    guard let root = conversationRoot(app) else { return nil }

    // First pass: labeled assistant-message groups.
    let labeled = findAllMatching(root) { el in
        guard let role = stringAttribute(el, kAXRoleAttribute),
              role == kAXGroupRole else { return false }
        let desc = stringAttribute(el, kAXDescriptionAttribute) ?? ""
        return ASSISTANT_LABELS.contains(desc)
    }
    if let last = labeled.last {
        let text = collectText(last, limit: 16_000)
        if !text.isEmpty { return text }
    }

    // Fallback: largest-group heuristic.
    let groups = findAll(root, roles: [kAXGroupRole, "AXArticle"], limit: 400)
    for group in groups.reversed() {
        let text = collectText(group, limit: 16_000)
        if text.count >= 40 {
            return text
        }
    }
    // Final fallback: full conversation text minus the composer text.
    let full = collectText(root)
    if let composer = composerElement(app), let c = stringAttribute(composer, kAXValueAttribute) {
        return full.replacingOccurrences(of: c, with: "")
    }
    return full
}

// Last user message bubble. Used as a fallback prompt detector when the
// composer-clears-on-submit transition isn't observed (typical when the app
// is opened mid-session and its AX tree hasn't plumbed in yet, or when the
// user types and sends faster than the daemon's poll interval). Only works
// for apps that label message bubbles via AXDescription (Antigravity does).
func lastUserText(_ app: AXUIElement) -> String? {
    guard let root = conversationRoot(app) else { return nil }
    let labeled = findAllMatching(root) { el in
        guard let role = stringAttribute(el, kAXRoleAttribute),
              role == kAXGroupRole else { return false }
        let desc = stringAttribute(el, kAXDescriptionAttribute) ?? ""
        return USER_LABELS.contains(desc)
    }
    guard let last = labeled.last else { return nil }
    let text = collectText(last, limit: 16_000)
    return text.isEmpty ? nil : text
}

// Dump the AX tree of an app for debugging. Emits a JSON object with a list of
// elements (role, depth, size, value preview, child count) up to maxDepth.
func dump(bundleId: String, maxDepth: Int = 22) -> [String: Any] {
    guard let app = axApp(forBundleId: bundleId) else {
        return ["ok": false, "bundleId": bundleId, "error": "app not running"]
    }
    guard let window = mainWindow(app) else {
        return ["ok": false, "bundleId": bundleId, "error": "no window"]
    }
    var nodes: [[String: Any]] = []
    walk(window, maxDepth: maxDepth) { el, depth in
        if nodes.count >= 2000 { return false }
        let role = stringAttribute(el, kAXRoleAttribute) ?? ""
        let value = stringAttribute(el, kAXValueAttribute) ?? ""
        let title = stringAttribute(el, kAXTitleAttribute) ?? ""
        let desc = stringAttribute(el, kAXDescriptionAttribute) ?? ""
        var sizeRef: AnyObject?
        var w: CGFloat = 0, h: CGFloat = 0
        if AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
           let v = sizeRef, CFGetTypeID(v) == AXValueGetTypeID() {
            var size = CGSize.zero
            AXValueGetValue(v as! AXValue, .cgSize, &size)
            w = size.width; h = size.height
        }
        let subrole = stringAttribute(el, kAXSubroleAttribute) ?? ""
        let roleDesc = stringAttribute(el, kAXRoleDescriptionAttribute) ?? ""
        let identifier = stringAttribute(el, kAXIdentifierAttribute) ?? ""
        let placeholder = stringAttribute(el, "AXPlaceholderValue") ?? ""
        nodes.append([
            "depth": depth,
            "role": role,
            "subrole": subrole,
            "roleDesc": roleDesc,
            "id": identifier,
            "placeholder": placeholder,
            "w": Double(w),
            "h": Double(h),
            "value": String(value.prefix(200)),
            "title": String(title.prefix(80)),
            "desc": String(desc.prefix(120)),
            "children": childrenAttribute(el).count
        ])
        return true
    }
    return ["ok": true, "bundleId": bundleId, "nodes": nodes]
}

func snapshot(bundleId: String) -> [String: Any] {
    guard let app = axApp(forBundleId: bundleId) else {
        return ["ok": false, "bundleId": bundleId, "error": "app not running"]
    }
    let composer = composerElement(app)
    // Chromium-based composers (Claude, ChatGPT) leak the placeholder text into
    // kAXValueAttribute when the user hasn't typed anything. Suppress that so
    // the daemon doesn't mistake the placeholder ("Type / for commands") for a
    // real prompt and record it on the next send transition.
    var composerText = ""
    if let el = composer {
        let raw = stringAttribute(el, kAXValueAttribute) ?? ""
        let placeholder = stringAttribute(el, "AXPlaceholderValue") ?? ""
        if !raw.isEmpty && raw != placeholder {
            composerText = raw
        }
    }
    let assistant = lastAssistantText(app) ?? ""
    let userBubble = lastUserText(app) ?? ""
    return [
        "ok": true,
        "bundleId": bundleId,
        "composer": composerText,
        "lastAssistantText": assistant,
        "lastUserText": userBubble,
        "ts": Int(Date().timeIntervalSince1970 * 1000)
    ]
}

func focusedApp() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return ["ok": false, "error": "no frontmost"]
    }
    var info: [String: Any] = [
        "ok": true,
        "bundleId": app.bundleIdentifier ?? "",
        "appName": app.localizedName ?? "",
        "pid": Int(app.processIdentifier)
    ]
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    if let window = attribute(axApp, kAXFocusedWindowAttribute) {
        let title = stringAttribute(window as! AXUIElement, kAXTitleAttribute) ?? ""
        info["windowTitle"] = title
    } else {
        info["windowTitle"] = ""
    }
    return info
}

func ping() -> [String: Any] {
    ["ok": true, "pong": Int(Date().timeIntervalSince1970 * 1000)]
}

// MARK: - Command loop

func handle(_ line: String) -> [String: Any] {
    let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
    guard let cmd = parts.first else { return ["ok": false, "error": "empty"] }
    switch cmd {
    case "ping":
        return ping()
    case "ax-permission":
        return ["ok": true, "granted": axIsTrusted(prompt: false)]
    case "ax-permission-prompt":
        return ["ok": true, "granted": axIsTrusted(prompt: true)]
    case "focused-app":
        return focusedApp()
    case "snapshot":
        guard parts.count >= 2 else { return ["ok": false, "error": "missing bundleId"] }
        return snapshot(bundleId: parts[1])
    case "dump":
        guard parts.count >= 2 else { return ["ok": false, "error": "missing bundleId"] }
        return dump(bundleId: parts[1])
    case "focused-element":
        guard parts.count >= 2 else { return ["ok": false, "error": "missing bundleId"] }
        guard let app = axApp(forBundleId: parts[1]) else {
            return ["ok": false, "error": "app not running"]
        }
        guard let focused = attribute(app, kAXFocusedUIElementAttribute) else {
            return ["ok": false, "error": "no focused element"]
        }
        let el = focused as! AXUIElement
        return [
            "ok": true,
            "role": stringAttribute(el, kAXRoleAttribute) ?? "",
            "subrole": stringAttribute(el, kAXSubroleAttribute) ?? "",
            "roleDesc": stringAttribute(el, kAXRoleDescriptionAttribute) ?? "",
            "id": stringAttribute(el, kAXIdentifierAttribute) ?? "",
            "value": stringAttribute(el, kAXValueAttribute) ?? "",
            "title": stringAttribute(el, kAXTitleAttribute) ?? "",
            "desc": stringAttribute(el, kAXDescriptionAttribute) ?? "",
            "placeholder": stringAttribute(el, "AXPlaceholderValue") ?? ""
        ]
    case "running":
        let ids = NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier }
        return ["ok": true, "bundleIds": ids]
    case "quit":
        exit(0)
    default:
        return ["ok": false, "error": "unknown command: \(cmd)"]
    }
}

// Line-buffered stdin reader using readabilityHandler so we don't block on
// `read(upToCount:)` when stdin is an open pipe with short writes.
setbuf(__stdoutp, nil)
let stdin = FileHandle.standardInput
var buffer = Data()
let exitGroup = DispatchGroup()
exitGroup.enter()

stdin.readabilityHandler = { fh in
    let chunk = fh.availableData
    if chunk.isEmpty {
        stdin.readabilityHandler = nil
        exitGroup.leave()
        return
    }
    buffer.append(chunk)
    while let nl = buffer.firstIndex(of: 0x0a) {
        let lineData = buffer.subdata(in: 0..<nl)
        buffer.removeSubrange(0...nl)
        guard let line = String(data: lineData, encoding: .utf8) else { continue }
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }
        writeJSON(handle(trimmed))
    }
}

exitGroup.wait()
