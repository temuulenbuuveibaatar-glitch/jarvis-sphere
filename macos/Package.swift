// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "JARVISMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "JARVISMac", targets: ["JARVISMac"])],
    targets: [
        .executableTarget(name: "JARVISMac"),
        .testTarget(name: "JARVISMacTests", dependencies: ["JARVISMac"]),
    ],
    swiftLanguageModes: [.v6]
)
