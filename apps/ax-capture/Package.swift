// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ax-capture",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ax-capture",
            path: "Sources/ax-capture"
        )
    ]
)
