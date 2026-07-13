#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(AtollMediaPlugin, "AtollMediaPlugin",
           CAP_PLUGIN_METHOD(compressVideo, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(extractThumbnail, CAPPluginReturnPromise);
)
