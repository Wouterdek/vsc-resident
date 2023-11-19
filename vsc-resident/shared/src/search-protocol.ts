/* eslint-disable @typescript-eslint/naming-convention */

export enum IpcProtocols {
    Hello = "hello",
    Echo = "echo",
    TypedMessage = "typed-message",
    Exception = "exception",
}

export class IpcMessage {
    Protocol?: IpcProtocols;
    Data?: IpcMessageData;
    RequestId: number = 0;
}

export class IpcRequest extends IpcMessage {
    RunOnSequentialQueue: boolean = false;
}

export class IpcResponse extends IpcMessage {}

export class IpcMessageData {}

export class ErrorResponse extends IpcMessageData {
    Message!: string;
    FullTypeName!: string;
    StackTrace!: string;
    InnerError!: ErrorResponse;
}

export class TypedMessage extends IpcMessageData {
    ClassName : string = "";
}

export class TypedRequest extends TypedMessage {}
export class TypedResponse extends TypedMessage {}

export class RegisterFileRequest extends TypedRequest {
    FileName: string = "";
}

export class UnregisterFileRequest extends TypedRequest {
    FileName: string = "";
}

export class SearchParams {
    SearchString : string = "";
    FilePathPattern : string = "";
    MaxResults : number = 0;
    MatchCase : boolean = false;
    MatchWholeWord : boolean = false;
    IncludeSymLinks : boolean = false;
    Regex : boolean = false;
    UseRe2Engine : boolean = false;
}

export class SearchCodeRequest extends TypedRequest {
    SearchParams? : SearchParams;
}

export class FilePositionSpan {
    /// <summary>
    /// The position, in character offset, of the first character of the span.
    /// </summary>
    Position : number = 0;

    /// <summary>
    /// The length, in number of characters, of the span.
    /// </summary>
    Length : number = 0;
}

export class FileSystemEntryData { }

export class FilePositionsData extends FileSystemEntryData {
    Positions : FilePositionSpan[] = [];
}

export class FileSystemEntry {
    Name: string = "";
    Data?: FileSystemEntryData;
}

export class FileEntry extends FileSystemEntryData {}

export class DirectoryEntry extends FileSystemEntry {
    Entries: FileSystemEntry[] = [];
}

export class SearchCodeResponse extends TypedResponse {
    /// <summary>
    /// This directory entry contains one child directory entry per project
    /// searched, and each of those entries containa a list of file entries
    /// matching the search criteria. Each file entry contains a list of
    /// FilePositionSpan in the <see cref="FileEntry.Data"/> property.
    /// </summary>
    SearchResults : DirectoryEntry = new DirectoryEntry();

    /// <summary>
    /// Total number of file spans returned in "SearchResults".
    /// </summary>
    HitCount : number = 0;

    /// <summary>
    /// Total number of files searched before reaching "MaxResults"
    /// </summary>
    SearchedFileCount : number = 0;

    /// <summary>
    /// Total number of files stored in the search index.
    /// </summary>
    TotalFileCount : number = 0;
}

export class GetFileExtractsRequest extends TypedRequest {
    FileName : string = "";
    Positions: FilePositionSpan[] = [];
    MaxExtractLength : number = 0;
}

export class FileExtract {
    /// <summary>
    /// The extracted text
    /// </summary>
    Text: string = "";
  
    /// <summary>
    /// The character offset of the extracted text.
    /// </summary>
    Offset: number = 0;
  
    /// <summary>
    /// The number of characters in extracted text.
    /// </summary>
    Length: number = 0;
  
    /// <summary>
    /// The line number of the extracted text.
    /// </summary>
    LineNumber: number = 0;
  
    ColumnNumber: number = 0;
  }

export class GetFileExtractsResponse extends TypedResponse {
    FileName : string = "";
    FileExtracts : FileExtract[] = [];
}

export class SearchFilePathsRequest extends TypedRequest {
    SearchParams? : SearchParams
}

export class SearchFilePathsResponse extends TypedResponse {
    /// <summary>
    /// This directory entry contains one child directory entry per project
    /// searched, and each of those entries contains a list of file entries
    /// matching the search criteria.
    /// </summary>
    SearchResult : DirectoryEntry = new DirectoryEntry

    /// <summary>
    /// Total number of entries returned in |FileNames|.
    /// </summary>
    HitCount : number = 0

    /// <summary>
    /// Total number of entries stored in the search index.
    /// </summary>
    TotalCount : number = 0
}

export class GetDatabaseStatisticsRequest extends TypedRequest {
    ForceGabageCollection : boolean = false
}

export class GetDatabaseStatisticsResponse extends TypedResponse {
    ProjectCount : number = 0;
    FileCount : number = 0;
    SearchableFileCount : number = 0;
    ServerNativeMemoryUsage : number = 0;
    ServerGcMemoryUsage : number = 0;
    IndexLastUpdatedUtc : any;
    ServerStatus! : IndexingServerStatus;
}
  
export enum IndexingServerStatus {
    /// <summary>
    /// The server is actually running
    /// </summary>
    Idle,
    /// <summary>
    /// The server received a request to go in a "pause" state
    /// </summary>
    Paused,
    /// <summary>
    /// The server put itself in "pause" mode because of a file system watcher buffer overflow error
    /// </summary>
    Yield,
    /// <summary>
    /// The server is busy indexing the file system
    /// </summary>
    Busy,
}
