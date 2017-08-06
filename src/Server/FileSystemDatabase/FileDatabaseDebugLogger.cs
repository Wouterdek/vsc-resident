﻿// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using VsChromium.Core.Linq;
using VsChromium.Core.Logging;
using VsChromium.Core.Utility;
using VsChromium.Server.FileSystemContents;

namespace VsChromium.Server.FileSystemDatabase {
  public class FileDatabaseDebugLogger {
    private static bool LogPiecesStats = false;
    private static bool LogContentsStats = false;
    private static int LogContentsStats_LargeFile_Threshold_Bytes = 500 * 1024;
    private static int LogContentsStats_FilesByExtensions_Threshold_Bytes = 100 * 1024;
    private static int LogContentsStats_ExtensionsList_Count = 10;
    private static int LogContentsStats_ExtensionsList_File_Count = 25;

    public static void LogFilePieces(ICollection<FileData> filesWithContents, IList<FileContentsPiece> filePieces, int partitionCount) {
      if (LogPiecesStats && Logger.Info) {
        Debug.Assert(filePieces.All(x => x != null));
        Debug.Assert(filePieces.Aggregate(0L, (c, x) => c + x.ByteLength) ==
          filesWithContents.Aggregate(0L, (c, x) => c + x.Contents.ByteLength));
        filePieces.GetPartitionRanges(partitionCount).ForAll(
          (index, range) => {
            Logger.LogInfo("Partition {0} has a size of {1}",
              index,
              FormatSizeAsKB(filePieces
                .Skip(range.Key)
                .Take(range.Value)
                .Aggregate(0L, (c, x) => c + x.ByteLength)));
          });
      }
    }

    public static void LogFileContentsStats(IList<FileData> filesWithContents) {
      if (LogContentsStats && Logger.Info) {
        var sectionSeparator = new string('=', 180);
        Logger.LogInfo("{0}", sectionSeparator);
        Logger.LogInfo("Index statistics");

        Logger.LogInfo("  {0}", sectionSeparator);
        Logger.LogInfo("  Part 1: Files larger than {0}", FormatSizeAsKB(LogContentsStats_LargeFile_Threshold_Bytes));

        var bigFiles = filesWithContents
          .Where(x => x.Contents.ByteLength >= LogContentsStats_LargeFile_Threshold_Bytes)
          .OrderBy(x => x.FileName);

        LogFileContentsByPath(bigFiles);

        Logger.LogInfo("  {0}", sectionSeparator);
        Logger.LogInfo("  Part 2: File extensions that occupy more than {0}",
          FormatSizeAsKB(LogContentsStats_FilesByExtensions_Threshold_Bytes));
        var filesByExtensions = filesWithContents
          .GroupBy(x => x.FileName.RelativePath.Extension)
          .Select(g => {
            var count = g.Count();
            var size = g.Aggregate(0L, (c, x) => c + x.Contents.ByteLength);
            return Tuple.Create(g.Key, count, size);
          })
          .Where(x => x.Item3 >= LogContentsStats_FilesByExtensions_Threshold_Bytes)
          .OrderByDescending(x => x.Item3)
          .ToList();

        var filesByExtensionsReport = new TextTableGenerator(text => Logger.LogInfo("    {0}", text));
        filesByExtensionsReport.AddColumn("Extension", 70, TextTableGenerator.Align.Left, TextTableGenerator.Stringifiers.RegularString);
        filesByExtensionsReport.AddColumn("File Count", 16, TextTableGenerator.Align.Right, TextTableGenerator.Stringifiers.DecimalGroupedInteger);
        filesByExtensionsReport.AddColumn("Size", 16, TextTableGenerator.Align.Right, FormatSizeAsKB);
        filesByExtensionsReport.GenerateReport(filesByExtensions.Select(g => new List<object> { g.Item1, g.Item2, g.Item3 }));

        for (var i = 0; i < Math.Min(LogContentsStats_ExtensionsList_Count, filesByExtensions.Count); i++) {
          var extension = filesByExtensions[i].Item1;

          Logger.LogInfo("  {0}", sectionSeparator);
          Logger.LogInfo("  Part {0}: {1} largest files for file extension \"{2}\"", i + 3, LogContentsStats_ExtensionsList_File_Count, extension);
          var extensionFiles = filesWithContents
            .Where(f => f.FileName.RelativePath.Extension == extension)
            .OrderByDescending(f => f.Contents.ByteLength)
            .Take(LogContentsStats_ExtensionsList_File_Count);
          LogFileContentsByPath(extensionFiles);
        }
      }
    }

    private static void LogFileContentsByPath(IEnumerable<FileData> bigFiles) {
      var table = new TextTableGenerator(text => Logger.LogInfo("    {0}", text));
      table.AddColumn("Path", 140, TextTableGenerator.Align.Left, TextTableGenerator.Stringifiers.EllipsisString);
      table.AddColumn("Size", 16, TextTableGenerator.Align.Right, FormatSizeAsKB);
      var files = bigFiles
        .Select(file => new List<object> {
            file.FileName.FullPath,
            file.Contents.ByteLength
        });
      table.GenerateReport(files);
    }

    private static string FormatSizeAsKB(TextTableGenerator.ColumnInfo columnInfo, object value) {
      return FormatSizeAsKB(Convert.ToInt64(value));
    }

    private static string FormatSizeAsKB(long value) {
      return string.Format("{0:n0} KB", value / 1024);
    }
  }
}