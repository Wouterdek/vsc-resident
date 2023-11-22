import { allComponents, provideVSCodeDesignSystem, DataGrid, vsCodeButton, vsCodeDropdown } from "@vscode/webview-ui-toolkit";
import * as shiki from 'shiki';

provideVSCodeDesignSystem().register(allComponents);

//@ts-check

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    const searchBox = document.querySelector('.search-box');
    const searchBoxDropdown = document.querySelector('.search-box-dropdown');
    const settingsExpandButton = document.querySelector('.settings-expand-button');
    const restartButton = document.querySelector('.restart-button');
    const serverStatusButton = document.querySelector('.server-status-button');
    const filePathsBoxContainer = document.querySelector('.file-paths-box-container');
    const filePathsBox = document.querySelector('.file-paths-box');
    const filePathsBoxDropdown = document.querySelector('.file-paths-box-dropdown');
    const caseSensitiveButton = document.querySelector('.case-sensitive-button');
    const wholeWordButton = document.querySelector('.whole-word-button');
    const regexButton = document.querySelector('.regex-button');
    const symlinkButton = document.querySelector('.symlink-button');
    const statusLabel = document.querySelector('.status-label');
    
    
    let isSettingsExpanded = true;

    let config = null;
    let configPromise;
    let configPromiseResolver:(()=>void)|null = null;
    let themeIsDark = false;

    settingsExpandButton.addEventListener('click', (e) => { setSettingsExpanded(!isSettingsExpanded); });
    restartButton.addEventListener('click', (e) => { vscode.postMessage({ type: 'restart' }); });
    serverStatusButton.addEventListener('click', (e) => { vscode.postMessage({ type: 'serverStatus' }); });
    searchBox.addEventListener('input', throttle((e) => { performSearch(); }, ()=>config.searchDebounceDelay));
    filePathsBox.addEventListener('input', throttle((e) => { performSearch(); }, ()=>config.searchDebounceDelay));

    caseSensitiveButton.addEventListener('change', (e) => { performSearch(); });
    wholeWordButton.addEventListener('change', (e) => { performSearch(); });
    regexButton.addEventListener('change', (e) => { performSearch(); });
    symlinkButton.addEventListener('change', (e) => { performSearch(); });

    searchBoxDropdown.onchange = function(e){ searchBox.value = searchBoxDropdown.selectedOptions[0].text; };
    filePathsBoxDropdown.onchange = function(e){ filePathsBox.value = filePathsBoxDropdown.selectedOptions[0].text; };

    let mediaFolder = document.getElementById("mainmodule")!.dataset.mediaroot;
    shiki.setCDN(mediaFolder+'/shiki/');
    let highlighter = shiki.getHighlighter({
        theme: 'dark-plus'
    });

    function throttle(func, delayFn){
        let timer;
        return (...args) => {
            if(timer) { clearTimeout(timer); }
            timer = setTimeout(() => {
                func(...args);
                timer = null;
            }, delayFn());
        };
      }

    function pullConfig(forceRefresh:boolean = false)
    {
        if(configPromise != null && !forceRefresh) { return configPromise;}
        configPromise = new Promise((resolve, reject) => {
            configPromiseResolver = () => {
                resolve(config);
                configPromiseResolver = null;
            };
        });
        vscode.postMessage({ 
            type: 'pullConfig'
        });
        return configPromise;
    }

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'setResults':
                {
                    setResults(message.results);
                    break;
                }
            case 'updateResultInfo':
                {
                    updateResultInfo(message.index, message.extracts);
                    break;
                }
            case 'themeChanged':
                {
                    themeIsDark = message.isDark;
                    refreshHighlighting();
                    break;
                }
            case 'configChanged':
                {
                    config = message.config;
                    if(configPromiseResolver != null) { configPromiseResolver(); }
                    break;
                }
            case 'setStatusLabel':
                {
                    statusLabel.innerText = message.label;
                    break;
                }
        }
    });

    function getDefaultState()
    {
        return {
            isSettingsExpanded: true,
            themeIsDark: false,
            searchBoxHistory: [],
            filePathsBoxHistory: [],
            query: {
                queryText: "",
                filePaths: "",
                caseSensitive: false,
                wholeWord: false,
                regex: false,
                symlink: false
            },
            results: [],
            status: ""
        };
    }

    function getState()
    {
        const query = {
            queryText: searchBox.value,
            filePaths: filePathsBox.value,
            caseSensitive: caseSensitiveButton.checked,
            wholeWord: wholeWordButton.checked,
            regex: regexButton.checked,
            symlink: symlinkButton.checked
        };
        return { 
            isSettingsExpanded: isSettingsExpanded,
            themeIsDark: themeIsDark,
            searchBoxHistory: getTextboxHistory(searchBoxDropdown),
            filePathsBoxHistory: getTextboxHistory(filePathsBoxDropdown),
            query: query, 
            results: searchResults,
            status: statusLabel.innerText
        };
    }

    function applyState(state)
    {
        setSettingsExpanded(state.isSettingsExpanded);
        themeIsDark = state.themeIsDark;
        searchBox.value = state.query.queryText;
        filePathsBox.value = state.query.filePaths;
        caseSensitiveButton.checked = state.query.caseSensitive;
        wholeWordButton.checked = state.query.wholeWord;
        regexButton.checked = state.query.regex;
        symlinkButton.checked = state.query.symlink;

        setTextboxHistory(searchBoxDropdown, state.searchBoxHistory);
        setTextboxHistory(filePathsBoxDropdown, state.filePathsBoxHistory);

        if(state.results)
        {
            setResults(state.results);
        }

        statusLabel.innerText = state.status;
    }

    
    function setSettingsExpanded(isExpanded)
    {
        isSettingsExpanded = isExpanded;

        settingsExpandButton.firstElementChild.className = "codicon codicon-chevron-" + (isExpanded ? "down" : "right");
        filePathsBoxContainer.style.display = isExpanded ? "" : "none";
        serverStatusButton.style.display = isExpanded ? "" : "none";
        restartButton.style.display = isExpanded ? "" : "none";
        statusLabel.style.display = isExpanded ? "" : "none";
    }

    function getTextboxHistory(dropdown)
    {
        return dropdown.innerHTML;
    }

    function setTextboxHistory(dropdown, history)
    {
        dropdown.innerHTML = history;
    }

    function addTextboxHistoryOption(dropdown, text: string)
    {
        if(text.length === 0) { return; }
        if(dropdown.firstElementChild && dropdown.firstElementChild.innerText === text) { return; }

        let newOption = document.createElement("vscode-option");
        newOption.innerText = text;
        dropdown.insertBefore(newOption, dropdown.firstElementChild);
        if(dropdown.childElementCount > 10)
        {
            dropdown.removeChild(dropdown.lastElementChild);
        }
    }

    function performSearch()
    {
        const state = getState();

        const timeBeforeAddedToSearchHistoryMs = 4000;
        setTimeout(() => {
            if(state.query.queryText == getState().query.queryText)
            {
                addTextboxHistoryOption(searchBoxDropdown, state.query.queryText);
            }
            if(state.query.filePaths == getState().query.filePaths)
            {
                addTextboxHistoryOption(filePathsBoxDropdown, state.query.filePaths);
            }
        }, timeBeforeAddedToSearchHistoryMs);

        clearResultsGrid();
        vscode.postMessage({ 
            type: 'search', 
            query: state.query,
        });

        vscode.setState(state);
    }

    class ResultsEntry
    {
        filePath:string;
        rootPath:string;
        lineNumber: number;
        columnNumber: number;
        matchLength: number;
        snippet:string;

        isOddFile: boolean;
    }

    function setResults(results : ResultsEntry[]) {
        clearResultsGrid();
        for (const result of results) {
            addResultRow(result);
        }

        const state = getState();
        vscode.setState(state);
    }

    const resultsGrid : HTMLDivElement = document.querySelector('.results-grid')!;
    let searchResults : ResultsEntry[];
    function clearResultsGrid()
    {
        searchResults = [];
        clearSelectedRows();
        resultsGrid.innerText = "";
    }

    function getHighlightingLanguageForPath(path?: string)
    {
        if(path == null) { return "cpp"; }

        let extension = path.substring(path.lastIndexOf('.')+1);
        switch(extension)
        {
            case "cs": return "cs";
            case "py": return "py";
            case "sh": return "sh";
            case "bat": return "bat";
            case "ps1": return "ps";
            case "js": return "js";
            case "ts": return "ts";
            case "tsx": return "tsx";
            case "go": return "go";
            case "rs": return "rust";
            case "md": return "md";
            case "json": return "json";
            case "xml": return "xml";
            case "yml":
            case "yaml": return "yaml";

            default: return "cpp";
        }
    }

    function addResultRow(entry: ResultsEntry)
    {
        searchResults.push(entry);
        
        let row = document.createElement("div");
        row.classList.add("row");
        row.classList.add(entry.isOddFile ? "oddfile" : "evenfile");
        row.dataset.index = resultsGrid.children.length.toString();

        let filename = document.createElement("div");
        filename.tabIndex = 0;
        filename.classList.add("item");
        filename.classList.add("front-ellipses");
        filename.innerText = entry.filePath;
        row.appendChild(filename);

        let seperator1 = document.createElement("div");
        seperator1.classList.add("column-separator");
        row.appendChild(seperator1);

        let lineNumber = document.createElement("div");
        lineNumber.tabIndex = 0;
        lineNumber.classList.add("item");
        lineNumber.innerText = entry.lineNumber.toString();
        row.appendChild(lineNumber);

        let seperator2 = document.createElement("div");
        seperator2.classList.add("column-separator");
        row.appendChild(seperator2);

        let snippet = document.createElement("div");
        snippet.tabIndex = 0;
        snippet.classList.add("item");
        if(entry.snippet)
        {
            snippet.innerText = entry.snippet;
            if(config.snippetHighlighting.enable)
            {
                highlighter.then(highlighter => {
                    snippet.innerHTML = highlighter.codeToHtml(entry.snippet, { lang: getHighlightingLanguageForPath(entry?.filePath) });
                });
            }
        }
        row.appendChild(snippet);

        resultsGrid.appendChild(row);
    }

    function updateResultInfo(startIndex, extracts)
    {
        let i = startIndex;
        for (const extract of extracts) {
            const row : HTMLDivElement = resultsGrid.children.item(i) as HTMLDivElement;
            //const filename = row.children.item(0)!;
            const lineNumber = row.children.item(2)!;
            const snippet = row.children.item(4)!;

            searchResults[i].snippet = extract.Text;
            snippet.textContent = extract.Text;
            if(config.snippetHighlighting.enable)
            {
                highlighter.then(highlighter => {
                    snippet.innerHTML = highlighter.codeToHtml(extract.Text, { lang: getHighlightingLanguageForPath(searchResults[i]?.filePath) });
                });
            }

            searchResults[i].lineNumber = extract.LineNumber;
            lineNumber.textContent = extract.LineNumber;
            searchResults[i].columnNumber = extract.ColumnNumber;

            i++;
        }

        const state = getState();
        vscode.setState(state);
    }

    function refreshHighlighting()
    {
        pullConfig().then(()=>{
            if(config.snippetHighlighting.enable)
            {
                highlighter = shiki.getHighlighter({
                    theme: themeIsDark ? config.snippetHighlighting.darkTheme : config.snippetHighlighting.lightTheme
                });
                setResults(searchResults);
            }
        });
    }

    let mouseDownColumnSeperator : Element|null = null;
    let selectedRows : Element[] = [];
    let firstSelectedRow : Element|null = null;
    function selectRow(row: Element, addToSelection:boolean)
    {
        if(!addToSelection) {
            clearSelectedRows();
            firstSelectedRow = row;
        }
        if(!selectedRows.includes(row))
        {
            selectedRows.push(row);
            row.classList.add("selected");
        }
        row.children.item(0)?.focus();
    }
    function clearSelectedRows()
    {
        for (const row of selectedRows) {
            row.classList.remove("selected");
        }
        selectedRows = [];
        firstSelectedRow = null;
    }
    function unselectRow(row: Element)
    {
        row.classList.remove("selected");
        selectedRows = selectedRows.splice(selectedRows.indexOf(row), 1);
        if(selectedRows.length === 0) { firstSelectedRow = null; }
    }
    function isRowSelected(row: Element)
    {
        return selectedRows.indexOf(row) >= 0;
    }
    resultsGrid.addEventListener('mousedown', e => {
        const event = e as MouseEvent;
        const isLeftButtonDown = (event.buttons & 1);
        let curTarget : Element | null = e.target as Element;
        while(curTarget && curTarget !== resultsGrid)
        {
            const targetClassList = curTarget.classList;
            if(targetClassList.contains("column-separator")) {
                if(isLeftButtonDown) {
                    mouseDownColumnSeperator = event.target as Element;
                    e.preventDefault();
                }
                break;
            } else if(targetClassList.contains("item")) {
                const row = curTarget!.parentElement;
                if(e.shiftKey && firstSelectedRow !== null)
                {
                    const rows = Array.from(row.parentNode!.children);
                    const firstSelectedRowIndex = Number.parseInt(firstSelectedRow.dataset.index);
                    const secondSelectedRowIndex = Number.parseInt(row.dataset.index);
                    const selectionStartIndex = Math.min(firstSelectedRowIndex, secondSelectedRowIndex);
                    const selectionEndIndex = Math.max(firstSelectedRowIndex, secondSelectedRowIndex);
                    clearSelectedRows();
                    for(let i = selectionStartIndex; i <= selectionEndIndex; ++i)
                    {
                        selectRow(rows[i], true);
                    }
                }
                else
                {
                    if(e.ctrlKey && isRowSelected(row))
                    {
                        unselectRow(row);
                    }
                    else
                    {
                        selectRow(row, e.ctrlKey);
                    }
                }
                e.preventDefault();
                break;
            }
            curTarget = curTarget.parentElement;
        }
    });
    resultsGrid.addEventListener('mousemove', (e) => {
        const event = e as MouseEvent;
        const isLeftButtonDown = (event.buttons & 1);
        if(isLeftButtonDown && mouseDownColumnSeperator) {
            const rowElements = Array.from(mouseDownColumnSeperator.parentNode!.children);
            const index = rowElements.indexOf(mouseDownColumnSeperator);
            let lcol = rowElements[index-1];
            let rcol = rowElements[index+1];
            
            let dragbarWidth = mouseDownColumnSeperator.clientWidth;
            let mouseX = event.clientX - lcol.offsetLeft;
            let lColWidth = mouseX;
            lColWidth = Math.max(lColWidth, 5);
            let rColWidth = (lcol.clientWidth + rcol.clientWidth) - lColWidth;
            rColWidth = Math.max(rColWidth, 5);
            
            let cols = rowElements.map(c => c.clientWidth);
            cols[index-1] = lColWidth;
            cols[index+1] = rColWidth;
            
            let newColDefn = cols.map(c => c.toString() + "px");
            newColDefn[newColDefn.length-1] = "1fr";

            resultsGrid.style.gridTemplateColumns = newColDefn.join(" ");
            
            event.preventDefault();
        }
        else
        {
            mouseDownColumnSeperator = null;
        }
    });
    function activateSelection()
    {
        if(selectedRows.length > 0)
        {
            const index = Number.parseInt(selectedRows[0].dataset.index);
            const entry = searchResults[index];
            vscode.postMessage({ 
                type: 'openFile', 
                entry: entry
            });
        }
    }
    resultsGrid.addEventListener('dblclick', (e) => {
        const targetClassList = (e.target as Element).classList;
        if(targetClassList.contains("item")) {
            const row = (e.target as Element).parentElement as HTMLDivElement;
            selectRow(row, false);
            activateSelection();
            e.preventDefault();
        }
    });
    resultsGrid.addEventListener('keydown', async (e) => {
        const targetClassList = (e.target as Element).classList;
        if(targetClassList.contains("item")) {
            const row = (e.target as Element).parentElement as HTMLDivElement;
            const index = Number.parseInt(row.dataset.index);

            const rows = Array.from(row.parentNode!.children); 
            let firstSelectedRowIndex : number|null = null;
            if(firstSelectedRow){ firstSelectedRowIndex = Number.parseInt(firstSelectedRow.dataset.index); }

            const prevRow = resultsGrid.children.item(Math.max(index-1, 0));
            const nextRow = resultsGrid.children.item(Math.min(index+1, rows.length-1));
            switch(e.key)
            {
                case "ArrowUp":
                    
                    if(!e.shiftKey || (firstSelectedRowIndex && index <= firstSelectedRowIndex)) { selectRow(prevRow, e.shiftKey); }
                    else { unselectRow(row); prevRow?.focus(); }
                    e.preventDefault();
                    break;
                case "ArrowDown":
                    if(e.shiftKey && (firstSelectedRowIndex && index < firstSelectedRowIndex)) { unselectRow(row); nextRow?.focus(); }
                    else { selectRow(nextRow, e.shiftKey); }
                    e.preventDefault();
                    break;
                case "PageUp":
                    selectRow(resultsGrid.children.item(Math.max(index-10, 0)), false);
                    e.preventDefault();
                    break;
                case "PageDown":
                    selectRow(resultsGrid.children.item(Math.min(index+10, resultsGrid.childElementCount-1)), false);
                    e.preventDefault();
                    break;
                case "Enter":
                    activateSelection();
                    e.preventDefault();
                    break;
                case "c":
                    if(e.ctrlKey)
                    {
                        e.preventDefault();
                        const selectedResults = selectedRows.map(row => searchResults[Number.parseInt(row.dataset.index)]);
                        const copyText = selectedResults.map(r => r.filePath + " | " + r.lineNumber + " | " + r.snippet).join("\n");
                        await navigator.clipboard.writeText(copyText);
                    }
                    break;
            }
        }
    });

    pullConfig().then(() => {
        const oldState = vscode.getState() || getDefaultState();
        applyState(oldState);
    });
}());
