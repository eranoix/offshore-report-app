import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let reader;
export const readerReady = () => {
  reader =
    reader ||
    import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    });
  return reader;
};
