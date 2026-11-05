// pdfpages <pdf> <prefix> <width> <pages>: the first pages as <prefix>-001.png, ...
// The preview mod builds this with swiftc where pdftoppm isn't installed (macOS).
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 5, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { exit(1) }
let width = CGFloat(Double(args[3]) ?? 1400)
for i in 0..<min(doc.pageCount, Int(args[4]) ?? 40) {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let image = page.thumbnail(of: NSSize(width: width, height: width * box.height / box.width), for: .mediaBox)
  guard let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { continue }
  try? png.write(to: URL(fileURLWithPath: args[2] + String(format: "-%03d.png", i + 1)))
}
