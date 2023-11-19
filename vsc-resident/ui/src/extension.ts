/*
TODO:
	highlight match in result, pause and refresh index buttons, virtualize results list, multiple search result windows
	auto-reactivate on workspace pluginhost crash, general robustness/error-handling, better build process,
	improve lag while streaming results,
	REGEX: handle namespace in function/class name
*/

import * as vscode from 'vscode';
import {
	TypedMessage, RegisterFileRequest, UnregisterFileRequest, SearchCodeRequest, SearchCodeResponse, SearchParams,
	GetFileExtractsRequest, GetFileExtractsResponse, FilePositionsData, DirectoryEntry, FileEntry, SearchFilePathsResponse, SearchFilePathsRequest, IpcRequest, IpcProtocols, IpcMessage, FileExtract, ErrorResponse, GetDatabaseStatisticsRequest, GetDatabaseStatisticsResponse, IndexingServerStatus
} from 'shared/search-protocol';
import { WorkspaceActivationRequest, WorkspaceActivationResponse, IpcMessageSet } from 'shared/extension-protocol';

const pathSeparator = "\\";

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number)
{
    const timeout = new Promise((resolve, reject) =>
        setTimeout(
            () => reject(),
            timeoutMs));
    return Promise.race([
        promise,
        timeout
    ]);
};

function getConfig()
{
	return vscode.workspace.getConfiguration("vsc-resident");
}

class CompositeDisposable
{
	public entries: {dispose():any}[] = [];
	dispose()
	{
		for (const entry of this.entries) {
			entry.dispose();
		}
		this.entries = [];
	}
}

class SearchEngineProxy
{
	public onSearchCodeResponse?: (requestId: number, msg: SearchCodeResponse) => void;
	public onGetFileExtractsResponse?: (requestId: number, msg: GetFileExtractsResponse) => void;
	public onSearchFilePathsResponse?: (requestId: number, msg: SearchFilePathsResponse) => void;	

	private engineMessageCommandId? : string;
	private engineRoutedMessageCommandId? : string;

	private activationMessages: TypedMessage[] = [];

	private requestId: number = 0;

	constructor(subscriptions: CompositeDisposable, private readonly workspaceMessageHandlerId: string)
	{
		subscriptions.entries.push(vscode.commands.registerCommand(workspaceMessageHandlerId, async (msgSet: IpcMessageSet) => {
			for (const msg of msgSet.messages) {
				this.receiveMessage(msg);
			}
		}));
	}

	public async activate()
	{
		const activationRequest = new WorkspaceActivationRequest;
		activationRequest.uiCommandId = this.workspaceMessageHandlerId;
		try {
			const activationResponse : WorkspaceActivationResponse = await vscode.commands.executeCommand('vsc-resident-workspace.activate', activationRequest);
			this.engineMessageCommandId = activationResponse.messageCommandId;
			this.engineRoutedMessageCommandId = activationResponse.routedMessageCommandId;
		}
		catch(e) {
			vscode.window.showErrorMessage('Could not activate vsc-resident-workspace. Make sure the extension is installed.');
			return false;
		}

		if(this.activationMessages.length > 0)
		{
			this.sendMessages(this.activationMessages, false);
		}
		return true;
	}

	public receiveMessage(ipcMsg: IpcMessage)
	{
		if(ipcMsg.Protocol === IpcProtocols.Exception)
		{
			console.error("[IPC exception message] "+(ipcMsg.Data as ErrorResponse).Message);
			return;
		}
		const msg = ipcMsg.Data as TypedMessage;
		switch(msg.ClassName)
		{
			case "SearchCodeResponse": {
				if(this.onSearchCodeResponse) { this.onSearchCodeResponse(ipcMsg.RequestId, msg as SearchCodeResponse); }
				break;
			}
			case "GetFileExtractsResponse": {
				if(this.onGetFileExtractsResponse) { this.onGetFileExtractsResponse(ipcMsg.RequestId, msg as GetFileExtractsResponse); }
				break;
			}
			case "SearchFilePathsResponse": {
				if(this.onSearchFilePathsResponse) { this.onSearchFilePathsResponse(ipcMsg.RequestId, msg as SearchFilePathsResponse); }
				break;
			}
		}
	}

	private async tryExecuteCommand(cmd: string, arg: any) : Promise<any>
	{
		try {
			return await vscode.commands.executeCommand(cmd, arg);
		} catch(failureReason) {
			console.error("Failed to send command: "+ failureReason);
			console.error("Retrying activation");
			await this.activate();
			return await vscode.commands.executeCommand(cmd, arg);
		}
	}

	public sendMessage(msg: TypedMessage, isActivationMessage: boolean = false) : number
	{
		if(this.engineMessageCommandId == null) { throw Error("No connection to backend server"); }
		if(isActivationMessage) {
			this.activationMessages.push(msg);
		}

		const request = new IpcRequest;
		request.Protocol = IpcProtocols.TypedMessage;
		request.Data = msg;
		request.RequestId = this.requestId++;
		
		let msgSet = new IpcMessageSet;
		msgSet.messages.push(request);
		this.tryExecuteCommand(this.engineMessageCommandId!, msgSet);
		
		return request.RequestId;
	}

	public sendMessages(msgs: TypedMessage[], areActivationMessages: boolean = false) : number
	{
		if(this.engineMessageCommandId == null) { throw Error("No connection to backend server"); }
		if(msgs.length === 0) { throw new Error("empty messageset"); }

		if(areActivationMessages) {
			this.activationMessages = this.activationMessages.concat(msgs);
		}

		let msgSet = new IpcMessageSet;
		for (const msg of msgs) {
			const request = new IpcRequest;
			request.Protocol = IpcProtocols.TypedMessage;
			request.Data = msg;
			request.RequestId = this.requestId++;
			msgSet.messages.push(request);
		}
		this.tryExecuteCommand(this.engineMessageCommandId!, msgSet);

		return msgSet.messages[0].RequestId;
	}

	public async sendRoutedMessage(msg: TypedMessage, isActivationMessage: boolean = false) : Promise<TypedMessage>
	{
		if(this.engineMessageCommandId == null) { throw Error("No connection to backend server"); }
		if(isActivationMessage) {
			this.activationMessages.push(msg);
		}

		const request = new IpcRequest;
		request.Protocol = IpcProtocols.TypedMessage;
		request.Data = msg;
		request.RequestId = this.requestId++;

		let msgSet = new IpcMessageSet;
		msgSet.messages.push(request);

		let response:IpcMessageSet = await this.tryExecuteCommand(this.engineRoutedMessageCommandId!, msgSet);
		let responseMsg = response.messages[0];
		if(responseMsg.Protocol === IpcProtocols.Exception)
		{
			throw new Error((responseMsg.Data as ErrorResponse).Message);
		}
		return responseMsg.Data as TypedMessage;
	}

	public async sendRoutedMessages(msgs: TypedMessage[], areActivationMessages: boolean = false) : Promise<TypedMessage[]>
	{
		if(this.engineMessageCommandId == null) { throw Error("No connection to backend server"); }
		if(msgs.length === 0) { return []; }

		if(areActivationMessages) {
			this.activationMessages = this.activationMessages.concat(msgs);
		}

		let msgSet = new IpcMessageSet;
		for (const msg of msgs) {
			const request = new IpcRequest;
			request.Protocol = IpcProtocols.TypedMessage;
			request.Data = msg;
			request.RequestId = this.requestId++;
			msgSet.messages.push(request);
		}

		let response:IpcMessageSet = await this.tryExecuteCommand(this.engineRoutedMessageCommandId!, msgSet);
		return response.messages.map(msg => {
			if(msg.Protocol === IpcProtocols.Exception)
			{
				throw new Error((msg.Data as ErrorResponse).Message);
			}
			return msg.Data as TypedMessage;
		});
	}

	public startSearch(query: SearchParams)
	{
		if(query.SearchString.length !== 0){
			const msg = new SearchCodeRequest;
			msg.ClassName = "SearchCodeRequest";
			msg.SearchParams = query;
			return this.sendMessage(msg);
		} else {
			const msg = new SearchFilePathsRequest;
			msg.ClassName = "SearchFilePathsRequest";
			msg.SearchParams = query;
			msg.SearchParams.SearchString = query.FilePathPattern;
			msg.SearchParams.FilePathPattern = "";
			return this.sendMessage(msg);
		}
	}

	public async search(query: SearchParams) : Promise<DirectoryEntry>
	{
		if(query.SearchString.length !== 0){
			const msg = new SearchCodeRequest;
			msg.ClassName = "SearchCodeRequest";
			msg.SearchParams = query;
			const response = await this.sendRoutedMessage(msg) as SearchCodeResponse;
			return response.SearchResults;
		} else {
			const msg = new SearchFilePathsRequest;
			msg.ClassName = "SearchFilePathsRequest";
			msg.SearchParams = query;
			msg.SearchParams.SearchString = query.FilePathPattern;
			msg.SearchParams.FilePathPattern = "";
			const response = await this.sendRoutedMessage(msg) as SearchFilePathsResponse;
			return response.SearchResult;
		}
	}
}

function zip<T1,T2>(itr1:T1[], itr2:T2[])
{
	return itr1.map((e, i) => {return {f1:e, f2:itr2[i]};});
}

class DefinitionProvider implements vscode.DefinitionProvider {
	constructor(private readonly searchEngine: SearchEngineProxy) { }

    public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition> {
		const wordRange = document.getWordRangeAtPosition(position);
		const lineText = document.lineAt(position.line).text;
		const word = wordRange ? document.getText(wordRange) : '';
		
		const makeQuery = function(regex: string)
		{
			const query = new SearchParams;
			query.SearchString = regex;
			const shaderFileRegex = new RegExp(".*(\\.hlsl|\\.glsl|\\.usf|\\.ush)");
			if(document.fileName.match(shaderFileRegex))
			{
				query.FilePathPattern = ".hlsl;.glsl;.usf;.ush";
			}
			else
			{
				query.FilePathPattern = ".cpp;.c;.h";
			}
			query.MatchCase = true;
			query.Regex = true;
			query.UseRe2Engine = true;
			query.MaxResults = 20;
			return query;
		};
		
		let searchResults : DirectoryEntry = await this.searchEngine.search(makeQuery(
			`(class|struct|union|enum)\\s*(\\[\\[[A-z0-9\\s:\\(\\),\\"]*\\]\\])*\\s*`+word+`\\s*(final)?[^A-z0-9;&\\*>]`
		));
		if(searchResults.Entries.length === 0)
		{
			searchResults = await this.searchEngine.search(makeQuery(
				`([[A-z][A-z0-9&\\*<>]*\\s+[A-z0-9<>]*::|[[A-z][A-z0-9&\\*<>]*\\s+)\\s*`+word+`\\s*\\([A-z0-9&\\*<>\\s,]*\\)[A-z\\s]*(;|{)`
			));
		}
		if(searchResults.Entries.length === 0)
		{
			searchResults = await this.searchEngine.search(makeQuery(word));
		}

		let results: vscode.Definition = [];
		if(searchResults && searchResults.Entries.length > 0)
		{
			for (const rootInfo of searchResults.Entries) {
				let files = (rootInfo as DirectoryEntry).Entries;
				let snippetRequests = [];
				for (const entryInfo of files) {
					let positions = (entryInfo.Data as FilePositionsData).Positions;

					const req = new GetFileExtractsRequest;
					req.ClassName = "GetFileExtractsRequest";
					req.MaxExtractLength = 10;
					req.FileName = rootInfo.Name + pathSeparator + entryInfo.Name;
					req.Positions = positions;
					snippetRequests.push(req);
				}
				const snippetResults : GetFileExtractsResponse[] = await this.searchEngine.sendRoutedMessages(snippetRequests) as GetFileExtractsResponse[];
				for (const {f1:entryInfo, f2:snippetResult} of zip(files, snippetResults)) {
					let positions = (entryInfo.Data as FilePositionsData).Positions;
					const extracts = snippetResult.FileExtracts.map((e, i) => {return {position: positions[i], extract: e}});

					for (const extract of extracts) {
						// function matching confuses return statements with function return types.
						if(extract.extract.Text.startsWith("return ")){ continue; }

						const posStart = new vscode.Position(extract.extract.LineNumber, extract.extract.ColumnNumber);
						const posEnd = new vscode.Position(extract.extract.LineNumber, extract.extract.ColumnNumber + extract.position.Length);
						const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, entryInfo.Name.replaceAll('\\', '/'));
						results.push(new vscode.Location(fileUri, new vscode.Range(posStart, posEnd)));
					}
				}
			}
		}
		
		return results;
    }
}

class Plugin 
{
	searchEngineSubscriptions: CompositeDisposable;
	view: SearchViewProvider;

	constructor(readonly context: vscode.ExtensionContext)
	{
		this.searchEngineSubscriptions = new CompositeDisposable();
		context.subscriptions.push(this.searchEngineSubscriptions);

		this.view = new SearchViewProvider(context);
		this.context.subscriptions.push(vscode.window.registerWebviewViewProvider(SearchViewProvider.viewType, this.view));
	}

	async restartBackend() {
		this.searchEngineSubscriptions.dispose();

		const workspaceMessageHandlerId = 'vsc-resident-ui.onWorkspaceMessage';
		const searchEngine = new SearchEngineProxy(this.searchEngineSubscriptions, workspaceMessageHandlerId);

		let lastSearchRequestId = -1;
		this.view.onSearch = (query) => { lastSearchRequestId = searchEngine.startSearch(query); };
		this.view.onRequestRestart = async () =>
		{
			if(await this.restartBackend())
			{
				vscode.window.showInformationMessage("Search server restarted");
			}
		};
		this.view.onViewServerStatus = async () => { 
			let request = new GetDatabaseStatisticsRequest();
			request.ClassName = "GetDatabaseStatisticsRequest";
			let response:GetDatabaseStatisticsResponse;
			try
			{
				response = await timeoutPromise(searchEngine.sendRoutedMessage(request), 3000) as GetDatabaseStatisticsResponse;
			}
			catch(ex)
			{
				vscode.window.showErrorMessage("Could not retrieve search server info. Try restarting/reinstalling.", { modal: true });
				return;
			}
			let msg = [
				"Search Server Statistics",
				"",
				"Server Status: " + IndexingServerStatus[response.ServerStatus],
				"Project Count: " + response.ProjectCount,
				"File Count: " + response.FileCount,
				"Searchable File Count: " + response.SearchableFileCount,
				"Server Native Memory Usage: " + response.ServerNativeMemoryUsage,
				"Server Gc Memory Usage: " + response.ServerGcMemoryUsage,
				"Index Last Updated Utc: " + response.IndexLastUpdatedUtc
			].join("\n");
			vscode.window.showInformationMessage(msg, { modal: true });
		 };

		if(!await searchEngine.activate())
		{
			return false;
		}
	
		if(getConfig().get<boolean>("enableGotoDefinition"))
		{
			this.searchEngineSubscriptions.entries.push(vscode.languages.registerDefinitionProvider(['cpp', 'c'], new DefinitionProvider(searchEngine)));
		}
	
		if(vscode.workspace.workspaceFolders)
		{
			for(const workspace of vscode.workspace.workspaceFolders)
			{
				const req = new RegisterFileRequest;
				req.ClassName = "RegisterFileRequest";
				req.FileName = workspace.uri.fsPath;
				searchEngine.sendMessage(req, true);
			}
		}
		this.searchEngineSubscriptions.entries.push(vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for(const workspace of e.added)
			{
				const req = new RegisterFileRequest;
				req.ClassName = "RegisterFileRequest";
				req.FileName = workspace.uri.fsPath;
				searchEngine.sendMessage(req, true);
			}
			for(const workspace of e.removed)
			{
				const req = new UnregisterFileRequest;
				req.ClassName = "UnregisterFileRequest";
				req.FileName = workspace.uri.fsPath;
				searchEngine.sendMessage(req, true);
			}
		}));

		searchEngine.onSearchCodeResponse = (requestId, msg) => {
			if(requestId < lastSearchRequestId) { return; }
	
			this.view.setResults(msg.SearchResults);

			let maxSnippetLength:number = getConfig().get("maxSnippetLength")!;
			if(maxSnippetLength > 0)
			{
				for(const rootinfo of msg.SearchResults.Entries)
				{
					let requests : GetFileExtractsRequest[] = [];
					for(const fileinfo of (rootinfo as DirectoryEntry).Entries)
					{
						const req = new GetFileExtractsRequest;
						req.ClassName = "GetFileExtractsRequest";
						req.MaxExtractLength = maxSnippetLength;
						req.FileName = rootinfo.Name + pathSeparator + fileinfo.Name;
						req.Positions = (fileinfo.Data as FilePositionsData).Positions;
						requests.push(req);
					}
					searchEngine.sendMessages(requests);
				}
			}
		};
		searchEngine.onGetFileExtractsResponse = (requestId, msg) => {
			if(requestId < lastSearchRequestId) { return; }
	
			this.view.setFileExtracts(msg);
		};
		searchEngine.onSearchFilePathsResponse = (requestId, msg) => {
			if(requestId < lastSearchRequestId) { return; }
	
			this.view.setResults(msg.SearchResult);
		};
		return true;
	}
}

let plugin : Plugin;
export async function activate(context: vscode.ExtensionContext) {
	plugin = new Plugin(context);
	await plugin.restartBackend();
}

export function deactivate() {}

class ViewData {
	filePath: string = "";
	lineNumber: number = 0;
	columnNumber: number = 0;
	matchLength: number = 0;
	snippet: string = "";
	isOddFile: boolean = false;
}

class SearchViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'vsc-resident.searchView';

	private _view?: vscode.WebviewView;

	public onSearch?: (query: SearchParams) => void;
	public onRequestRestart?: () => void;
	public onViewServerStatus?: () => void;

	constructor(
		readonly context: vscode.ExtensionContext
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this.context.extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'search':
					{
						const searchParams = new SearchParams;
						searchParams.SearchString = data.query.queryText;
						searchParams.FilePathPattern = data.query.filePaths;
						searchParams.MatchCase = data.query.caseSensitive;
						searchParams.MatchWholeWord = data.query.wholeWord;
						searchParams.Regex = data.query.regex;
						searchParams.IncludeSymLinks = data.query.symlink;
						searchParams.MaxResults = getConfig().get<number>("maxResults")!;
						searchParams.UseRe2Engine = true;

						if(this.onSearch){ this.onSearch(searchParams); }
						break;
					}
				case 'openFile':
					{
						let entry : ViewData = data.entry;

						var pos = new vscode.Position(entry.lineNumber, entry.columnNumber);
						var posEnd = new vscode.Position(entry.lineNumber, entry.columnNumber + entry.matchLength /*todo: multiline*/ );
						var openPath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, entry.filePath);
						vscode.workspace.openTextDocument(openPath).then(doc => 
						{
							vscode.window.showTextDocument(doc).then(editor => 
							{
								if(entry.matchLength !== 0)
								{
									editor.selections = [new vscode.Selection(pos,posEnd)];
									var range = new vscode.Range(pos, pos);
									editor.revealRange(range);
								}
							});
						});
						break;
					}
				case 'restart':
					{
						if(this.onRequestRestart){ this.onRequestRestart(); }
						break;
					}
				case 'serverStatus':
					{
						if(this.onViewServerStatus){ this.onViewServerStatus(); }
						break;
					}
				case 'pullConfig':
					{
						this.updateConfig();
						break;
					}
			}
		});

		this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
			if(e.affectsConfiguration("vsc-resident"))
			{
				this.updateConfig();
			}
		}));

		this._view?.webview.postMessage({ type: 'themeChanged', isDark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark });
		this.context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(e => {
			this._view?.webview.postMessage({ type: 'themeChanged', isDark: e.kind === vscode.ColorThemeKind.Dark });
		}));

		this._view?.webview.postMessage({ type: 'applyState' });
	}

	private updateConfig()
	{
		let config = getConfig();
		let configObj = {
			searchDebounceDelay: config.get<number>("searchDebounceDelay"),
			snippetHighlighting: {
				enable: config.get<boolean>("snippetHighlighting.enable"),
				lightTheme: config.get<string>("snippetHighlighting.lightTheme"),
				darkTheme: config.get<string>("snippetHighlighting.darkTheme")
			}
		};
		this._view?.webview.postMessage({ type: 'configChanged', config: configObj });
	}

	private viewData : ViewData[] = [];
	private pathToViewData : { [id: string] : number } = {};
	public setResults(searchResults : DirectoryEntry) {
		if (this._view) {
			this._view.show?.(true);

			this.viewData = [];
			this.pathToViewData = {};
			let fileIndexIsOdd = true;
			let index = 0;
			for (const result of searchResults.Entries) {
				for (const entry of (result as DirectoryEntry).Entries) {
					this.pathToViewData[result.Name + pathSeparator + entry.Name] = index;

					if(entry.Data) // code search
					{
						for (const position of (entry.Data! as FilePositionsData).Positions) {
							this.viewData.push({
								filePath: entry.Name,
								lineNumber: 0,
								columnNumber: 0,
								matchLength: position.Length,
								snippet: "",
								isOddFile: fileIndexIsOdd
							});
							index++;
						}
					}
					else // file search
					{
						this.viewData.push({
							filePath: entry.Name,
							lineNumber: 0,
							columnNumber: 0,
							matchLength: 0,
							snippet: "",
							isOddFile: fileIndexIsOdd
						});
						index++;
					}
					
					fileIndexIsOdd = !fileIndexIsOdd;
				}
			}

			this._view.webview.postMessage({ type: 'setResults', results: this.viewData });
		}
	}

	public setFileExtracts(extracts : GetFileExtractsResponse) {
		if (this._view && this.pathToViewData) {
			const idx = this.pathToViewData[extracts.FileName];
			
			this._view.webview.postMessage({ type: 'updateResultInfo', index: idx, extracts: extracts.FileExtracts });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'));

		// Do the same for the stylesheet.
		const mediaRootUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media'));
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
		const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'codicon.css'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<!--<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource};">-->

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">
				<link href="${codiconUri}" rel="stylesheet">
			</head>
			<body>
				<div class="search-settings-panel">
					<vscode-button appearance="icon" aria-label="Toggle expand" class="settings-expand-button">
						<span class="codicon codicon-chevron-down"></span>
					</vscode-button>
					<div class="settings-inner-panel">
						<div class="search-box-container dropdown-textbox-container">
							<vscode-dropdown position="below" class="search-box-dropdown dropdown-textbox-container-dropdown">
								<span slot="selected-value"></span>
							</vscode-dropdown>
							<vscode-text-field class="search-box dropdown-textbox-container-textbox" placeholder="Search" autofocus tabindex=1>
								<label slot="end" class="togglebutton" title="Match case">
									<input type="checkbox" class="case-sensitive-button"/>
									<span class="codicon codicon-case-sensitive"></span>
								</label>
								<label slot="end" class="togglebutton" title="Match whole word">
									<input type="checkbox" class="whole-word-button"/>
									<span class="codicon codicon-whole-word"></span>
								</label>
								<label slot="end" class="togglebutton" title="Use regular expression">
									<input type="checkbox" class="regex-button"/>
									<span slot="end" class="codicon codicon-regex"></span>
								</label>
								<label slot="end" class="togglebutton" title="Search inside symbolic links directories">
									<input type="checkbox" class="symlink-button"/>
									<span slot="end" class="codicon codicon-file-symlink-file"></span>
								</label>
							</vscode-text-field>
						</div>

						<div class="file-paths-box-container dropdown-textbox-container">
							<vscode-dropdown position="below" class="file-paths-box-dropdown dropdown-textbox-container-dropdown">
								<span slot="selected-value"></span>
							</vscode-dropdown>
							<vscode-text-field class="file-paths-box dropdown-textbox-container-textbox" placeholder="File paths" tabindex=2>
							</vscode-text-field>
						</div>
					</div>
					<div>
						<vscode-button appearance="icon" title="Restart server" class="restart-button">
							<span class="codicon codicon-refresh"></span>
						</vscode-button>
						<vscode-button appearance="icon" title="View server status" class="server-status-button">
							<span class="codicon codicon-question"></span>
						</vscode-button>
					</div>
				</div>

				<div class="results-box" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
					<div class="results-grid">
					</div>
				</div>

				<script id="mainmodule" data-mediaroot="${mediaRootUri}" type="module" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

