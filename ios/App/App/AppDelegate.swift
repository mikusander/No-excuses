import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    
    // Default orientation is strictly portrait throughout the app
    static var orientationLock: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return AppDelegate.orientationLock
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/**
 * AppOrientationPlugin — Bridge nativo Capacitor per controllare l'orientamento dello schermo.
 * Permette di sbloccare la rotazione in orizzontale durante il workout e bloccarla
 * rigorosamente in verticale in tutte le altre sezioni dell'app.
 */
@objc(AppOrientationPlugin)
public class AppOrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppOrientationPlugin"
    public let jsName = "AppOrientationPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lockPortrait", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockForWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockLandscape", returnType: CAPPluginReturnPromise)
    ]

    @objc func lockPortrait(_ call: CAPPluginCall) {
        AppDelegate.orientationLock = .portrait
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                if let windowScene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    let geometryPreferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: .portrait)
                    windowScene.requestGeometryUpdate(geometryPreferences) { _ in }
                }
                UIViewController.attemptRotationToDeviceOrientation()
            } else {
                UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
                UIViewController.attemptRotationToDeviceOrientation()
            }
            call.resolve(["mode": "portrait"])
        }
    }

    @objc func unlockForWorkout(_ call: CAPPluginCall) {
        AppDelegate.orientationLock = [.portrait, .landscapeLeft, .landscapeRight]
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                if let windowScene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    let geometryPreferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: [.portrait, .landscapeLeft, .landscapeRight])
                    windowScene.requestGeometryUpdate(geometryPreferences) { _ in }
                }
                UIViewController.attemptRotationToDeviceOrientation()
            } else {
                UIViewController.attemptRotationToDeviceOrientation()
            }
            call.resolve(["mode": "unlocked"])
        }
    }

    @objc func lockLandscape(_ call: CAPPluginCall) {
        AppDelegate.orientationLock = [.landscapeLeft, .landscapeRight]
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                if let windowScene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    let geometryPreferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: .landscapeRight)
                    windowScene.requestGeometryUpdate(geometryPreferences) { _ in }
                }
                UIViewController.attemptRotationToDeviceOrientation()
            } else {
                UIDevice.current.setValue(UIInterfaceOrientation.landscapeRight.rawValue, forKey: "orientation")
                UIViewController.attemptRotationToDeviceOrientation()
            }
            call.resolve(["mode": "landscape"])
        }
    }
}
