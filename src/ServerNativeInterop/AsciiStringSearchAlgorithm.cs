﻿// Copyright 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

using System;
using System.Collections.Generic;
using VsChromium.Core.Ipc.TypedMessages;
using VsChromium.Core.Utility;

namespace VsChromium.Server.NativeInterop {
  public abstract class AsciiStringSearchAlgorithm : IDisposable {

    public abstract int PatternLength { get; }
    public abstract int SearchBufferSize { get; }

    public abstract void Search(ref NativeMethods.SearchParams searchParams);
    public abstract void CancelSearch(ref NativeMethods.SearchParams searchParams);

    public virtual void Dispose() {
    }

    private static readonly List<FilePositionSpan> NoResult = new List<FilePositionSpan>();

    /// <summary>
    /// Find all occurrences of the pattern in the text block starting at
    /// |<paramref name="textPtr"/>| and containing |<paramref name="textLength"/>|
    /// characters.
    /// </summary>
    public IEnumerable<FilePositionSpan> SearchAll(
        string path,
        IntPtr textPtr,
        long offset,
        int length,
        IOperationProgressTracker progressTracker) {
      return SearchAllWorker(textPtr, offset, length, progressTracker);
    }

    private IEnumerable<FilePositionSpan> SearchAllWorker(
        IntPtr textPtr,
        long offset,
        int length,
        IOperationProgressTracker progressTracker) {
      List<FilePositionSpan> result = null;
      SearchChunk(textPtr, length, offset, progressTracker, ref result);
      return result ?? NoResult;
    }

    private unsafe void SearchChunk(
        IntPtr chunkPtr,
        int chunkLength,
        long chunkOffsetFromTextStart,
        IOperationProgressTracker progressTracker,
        ref List<FilePositionSpan> result) {
      if (progressTracker.ShouldEndProcessing) {
        return;
      }

      // Note: From C# spec: If E is zero, then no allocation is made, and
      // the pointer returned is implementation-defined. 
      byte* searchBuffer = stackalloc byte[this.SearchBufferSize];
      var searchParams = new NativeMethods.SearchParams {
        TextStart = chunkPtr,
        TextLength = chunkLength,
        SearchBuffer = new IntPtr(searchBuffer),
      };

      while (true) {
        // Perform next search
        Search(ref searchParams);
        if (searchParams.MatchStart == IntPtr.Zero)
          break;

        // Add result
        if (result == null)
          result = new List<FilePositionSpan>();
        result.Add(new FilePositionSpan {
          // TODO(rpaquay): We are limited to 2GB for now.
          Position =(int) chunkOffsetFromTextStart + Pointers.Offset32(chunkPtr, searchParams.MatchStart),
          Length = searchParams.MatchLength
        });

        // Check it is time to end processing early.
        progressTracker.AddResults(1);
        if (progressTracker.ShouldEndProcessing) {
          CancelSearch(ref searchParams);
          break;
        }
      }
    }
  }
}
