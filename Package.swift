// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapgoCapacitorFastSql",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapgoCapacitorFastSql",
            targets: ["CapgoCapacitorFastSqlPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/Building42/Telegraph.git", from: "0.40.0")
    ],
    targets: [
        .target(
            name: "CapgoCapacitorFastSqlPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "Telegraph", package: "Telegraph")
            ],
            path: "ios/Sources/CapgoCapacitorFastSqlPlugin"),
        .testTarget(
            name: "CapgoCapacitorFastSqlPluginTests",
            dependencies: ["CapgoCapacitorFastSqlPlugin"],
            path: "ios/Tests/CapgoCapacitorFastSqlPluginTests")
    ]
)
