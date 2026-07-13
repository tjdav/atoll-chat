import Foundation
import Capacitor
import AVFoundation

#if canImport(UIKit)
import UIKit
#endif

@objc(AtollMediaPlugin)
public class AtollMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AtollMediaPlugin"
    public let jsName = "AtollMediaPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "compressVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extractThumbnail", returnType: CAPPluginReturnPromise)
    ]

    @objc func compressVideo(_ call: CAPPluginCall) {
        guard let sourcePath = call.getString("sourcePath") else {
            call.reject("sourcePath is required")
            return
        }
        let _quality = call.getDouble("quality") ?? 0.8
        
        // Clean up source path prefix if it contains file://
        var cleanPath = sourcePath
        if cleanPath.hasPrefix("file://") {
            cleanPath = String(cleanPath.dropFirst(7))
        }
        
        let fileURL = URL(fileURLWithPath: cleanPath)
        let asset = AVAsset(url: fileURL)
        
        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else {
            call.reject("Failed to create AVAssetExportSession")
            return
        }
        
        let uniqueID = UUID().uuidString
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let outputURL = tempDir.appendingPathComponent("compressed-\(uniqueID).mp4")
        
        exportSession.outputURL = outputURL
        exportSession.outputFileType = .mp4
        exportSession.shouldOptimizeForNetworkUse = true
        
        exportSession.exportAsynchronously {
            switch exportSession.status {
            case .completed:
                call.resolve(["destinationPath": outputURL.path])
            case .failed:
                let errorMsg = exportSession.error?.localizedDescription ?? "Unknown export error"
                call.reject("Video compression failed: \(errorMsg)")
            case .cancelled:
                call.reject("Video compression cancelled")
            default:
                call.reject("Video compression failed with status: \(exportSession.status.rawValue)")
            }
        }
    }

    @objc func extractThumbnail(_ call: CAPPluginCall) {
        guard let sourcePath = call.getString("sourcePath") else {
            call.reject("sourcePath is required")
            return
        }
        
        // Clean up source path prefix if it contains file://
        var cleanPath = sourcePath
        if cleanPath.hasPrefix("file://") {
            cleanPath = String(cleanPath.dropFirst(7))
        }
        
        let fileURL = URL(fileURLWithPath: cleanPath)
        let asset = AVAsset(url: fileURL)
        let imageGenerator = AVAssetImageGenerator(asset: asset)
        imageGenerator.appliesPreferredTrackTransform = true
        
        let duration = CMTimeGetSeconds(asset.duration)
        let time = CMTime(seconds: 0.0, preferredTimescale: 600)
        
        do {
            let cgImage = try imageGenerator.copyCGImage(at: time, actualTime: nil)
            
            #if canImport(UIKit)
            let uiImage = UIImage(cgImage: cgImage)
            guard let data = uiImage.jpegData(compressionQuality: 0.8) else {
                call.reject("Failed to convert image to JPEG data")
                return
            }
            #else
            // Fallback for macOS/other platforms where UIKit is unavailable
            call.reject("Platform does not support JPEG conversion natively")
            return
            #endif
            
            let uniqueID = UUID().uuidString
            let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            let outputURL = tempDir.appendingPathComponent("thumbnail-\(uniqueID).jpg")
            
            try data.write(to: outputURL)
            
            call.resolve([
                "thumbnailPath": outputURL.path,
                "duration": duration.isNaN ? 0.0 : duration
            ])
        } catch {
            // Gracefully resolve with null thumbnailPath if image extraction fails (e.g. for audio files)
            call.resolve([
                "thumbnailPath": NSNull(),
                "duration": duration.isNaN ? 0.0 : duration
            ])
        }
    }
}
