import {
  workspace,
  ExtensionContext,
  commands,
  window,
  QuickPickItem,
  SnippetString,
  extensions,
  MessageItem,
  env,
  Uri,
  Selection,
  Position,
} from "vscode";

interface ISurroundItem {
  label: string;
  description?: string;
  detail?: string;
  snippet: string;
  disabled?: boolean;
  languageIds?: string;
}

interface ISurroundConfig {
  [key: string]: ISurroundItem;
}

function getLanguageId(): string | undefined {
  let editor = window.activeTextEditor;
  if (editor === undefined) {
    return undefined;
  }
  return editor.document.languageId;
}

function filterSurroundItems(items: ISurroundItem[], languageId?: string) {
  if (languageId === undefined) {
    return items;
  }
  return items.filter((item) => {
    if (!item.languageIds || item.languageIds.length < 1) {
      return true;
    }

    if (item.languageIds.includes(`-${languageId}`)) {
      return false;
    }

    if (
      item.languageIds.includes("*") ||
      item.languageIds.includes(languageId)
    ) {
      return true;
    }

    return false;
  });
}

function getSurroundConfig(): ISurroundConfig {
  let config = workspace.getConfiguration("surround");
  const showOnlyUserDefinedSnippets = config.get(
    "showOnlyUserDefinedSnippets",
    false
  );
  const items = showOnlyUserDefinedSnippets
    ? {}
    : <ISurroundConfig>config.get("with", {});
  const custom = <ISurroundConfig>config.get("custom", {});

  for (const key of Object.keys(custom)) {
    if (typeof custom[key] !== "object" || !custom[key].label) {
      window.showErrorMessage(
        `Invalid custom config for Surround: surround.custom.${key}!\nPlease check your settings!`
      );
      return { ...items };
    }
  }

  return { ...items, ...custom };
}

function getEnabledSurroundItems(surroundConfig: ISurroundConfig): ISurroundItem[] {
  return Object.values(surroundConfig).filter((surroundItem) => !surroundItem.disabled);
}

function trimSelection(selection: Selection): Selection | undefined {
  let activeEditor = window.activeTextEditor;
  if (activeEditor && selection) {
    const startLine = selection.start.line;
    const endLine = selection.end.line;

    let startPosition: Position | undefined = undefined;
    let endPosition: Position | undefined = undefined;

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
      const line = activeEditor.document.lineAt(lineNo);
      if (line.isEmptyOrWhitespace) {
        continue;
      }

      if (
        lineNo === startLine &&
        !line.text.slice(selection.start.character).trim()
      ) {
        continue;
      }

      if (
        lineNo > startLine &&
        lineNo === endLine &&
        selection.end.character < line.firstNonWhitespaceCharacterIndex
      ) {
        continue;
      }

      if (!startPosition) {
        // find start character index
        let startCharacter = line.firstNonWhitespaceCharacterIndex;

        if (lineNo === startLine) {
          startCharacter = Math.max(startCharacter, selection.start.character);
        }

        startPosition = new Position(lineNo, startCharacter);
      }

      // find end character index
      let endCharacter =
        line.firstNonWhitespaceCharacterIndex + line.text.trim().length;

      if (lineNo === endLine) {
        endCharacter = Math.min(endCharacter, selection.end.character);
      }

      endPosition = new Position(lineNo, endCharacter);
    }

    if (startPosition && endPosition) {
      return new Selection(startPosition, endPosition);
    }
  }

  return undefined;
}

function trimSelections(): void {
  let activeEditor = window.activeTextEditor;
  if (!activeEditor || !activeEditor.selections) {
    return;
  }
  
  const selections: Selection[] = activeEditor.selections.map((selection) => {
    const { start, end } = selection;

    if (start.line === end.line && start.character === end.character) {
      return selection;
    }

    const trimmedSelection = trimSelection(selection);
    return trimmedSelection || selection;
  });;

  

  activeEditor.selections = selections;
}

function applyQuickPick(item: QuickPickItem, surroundItems: ISurroundItem[]) {
  const activeEditor = window.activeTextEditor;

  if (!activeEditor || !item) { return; }

  const surroundItem = surroundItems.find((s) => item.label === s.label);
  if (!surroundItem) { return; }
  
  try {
    trimSelections();
    activeEditor.insertSnippet(new SnippetString(surroundItem.snippet));
  } catch (err) {
    window.showErrorMessage(
      "Could not apply surround snippet: " + surroundItem.label,
      String(err)
    );
  }
}

function applySurroundItem(key: string, surroundConfig: ISurroundConfig) {
  if (window.activeTextEditor && surroundConfig[key]) {
    const surroundItem: ISurroundItem = surroundConfig[key];
    window.activeTextEditor.insertSnippet(
      new SnippetString(surroundItem.snippet)
    );
  }
}

async function registerCommands(
  context: ExtensionContext,
  surroundConfig: ISurroundConfig
) {
  const registeredCommands = await commands.getCommands();
  Object.keys(surroundConfig).forEach((key) => {
    const commandText = `surround.with.${key}`;
    if (!registeredCommands.includes(commandText)) {
      context.subscriptions.push(
        commands.registerCommand(commandText, () => {
          applySurroundItem(key, surroundConfig);
        })
      );
    }
  });
}

const SURROUND_LAST_VERSION_KEY = "yatki.vscode-surround:last-version";
const PENDING_FOCUS = "yatki.vscode-surround:pending-focus";

async function showWelcomeOrWhatsNew(
  context: ExtensionContext,
  version: string,
  previousVersion: string | undefined
) {
  if (previousVersion !== version) {
    if (window.state.focused) {
      void context.globalState.update(PENDING_FOCUS, undefined);
      void context.globalState.update(SURROUND_LAST_VERSION_KEY, version);
      void showMessage(version, previousVersion);
    } else {
      // Save pending on window getting focus
      await context.globalState.update(PENDING_FOCUS, true);
      const disposable = window.onDidChangeWindowState((e) => {
        if (!e.focused) {
          return;
        }

        disposable.dispose();

        // If the window is now focused and we are pending the welcome, clear the pending state and show the welcome
        if (context.globalState.get(PENDING_FOCUS) === true) {
          void context.globalState.update(PENDING_FOCUS, undefined);
          void context.globalState.update(SURROUND_LAST_VERSION_KEY, version);
          void showMessage(version, previousVersion);
        }
      });
      context.subscriptions.push(disposable);
    }
  }
}

async function showMessage(version: string, previousVersion?: string) {
  const whatsNew = { title: "What's New" };
  const giveAStar = { title: "★ Give a star" };
  const sponsor = { title: "❤ Sponsor" };
  const actions: MessageItem[] = [giveAStar, sponsor];

  const showUpdateNotifications = !!workspace
    .getConfiguration("surround")
    .get("showUpdateNotifications");

  if (previousVersion) {
    if (!showUpdateNotifications) {
      return;
    }
    actions.unshift(whatsNew);
  }

  const message = previousVersion
    ? `Surround has been updated to v${version}! — check out what's new!`
    : "Thanks for using Surround — have a beautiful day! 🖖🏻 Cheers,";

  const result = await window.showInformationMessage(message, ...actions);

  switch (result) {
    case whatsNew:
      await env.openExternal(Uri.parse("https://github.com/yatki/vscode-surround/releases"));
      break;
    case giveAStar:
      await env.openExternal(Uri.parse("https://github.com/yatki/vscode-surround"));
      break;
    case sponsor:
      await env.openExternal(Uri.parse("https://github.com/sponsors/yatki"));
      break;
    default:
      break;
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
  let surroundItems: ISurroundItem[] = [];
  let showRecentlyUsedFirst = true;
  let surroundConfig: ISurroundConfig;

  const previousVersion = context.globalState.get<string>(
    SURROUND_LAST_VERSION_KEY
  );
  const surroundExt = extensions.getExtension("yatki.vscode-surround")!;
  const surroundVersion = surroundExt.packageJSON.version;

  function update() {
    surroundConfig = getSurroundConfig();

    showRecentlyUsedFirst = !!workspace
      .getConfiguration("surround")
      .get("showRecentlyUsedFirst");
    surroundItems = getEnabledSurroundItems(surroundConfig);

    registerCommands(context, surroundConfig);
  }

  workspace.onDidChangeConfiguration(() => {
    update();
  });

  update();
  void showWelcomeOrWhatsNew(context, surroundVersion, previousVersion);

  let disposable = commands.registerCommand("surround.with", async () => {
    let quickPickItems = filterSurroundItems(
      surroundItems,
      getLanguageId()
    ).map(({ label, description }) => ({
      label,
      description,
    }));

    const item = await window.showQuickPick(quickPickItems, {
      placeHolder: "Type the label of the snippet",
      matchOnDescription: true,
    });

    if (!item) {
      return;
    }

    applyQuickPick(item, surroundItems);

    const selectedSurroundItem = surroundItems.find(
      (i) => i.label === item.label && i.description === item.description
    );

    if (showRecentlyUsedFirst && selectedSurroundItem) {
      surroundItems = surroundItems.filter(
        (i) => i.label !== item.label || i.description !== item.description
      );
      surroundItems.unshift(selectedSurroundItem);
    }
  });

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
