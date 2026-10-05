# Electron Benchmarks

English | [简体中文](README.zh-CN.md)

Reproducible performance benchmarks for Electron, covering startup time, memory usage, and CPU usage across versions.

## Purpose

Electron Benchmarks aims to measure Electron's own performance through standardized scenarios. It helps maintainers and developers compare versions, detect performance regressions, and validate optimizations.

The project is currently in the planning stage.

## Test modes

- **Single-version testing**: Run standardized scenarios against one Electron version and report metrics, raw samples, and environment details.
- **Multi-version comparison**: Run the same standardized scenarios against multiple Electron versions in the same environment. Choose a baseline version and report each version's metrics, absolute differences, and percentage changes relative to that baseline.

## Structure

Standardized scenarios define the workloads. A shared Runner executes scenarios and collects data. A Reporter produces measurement results and version comparison reports.

Configuration, repeated runs, and reporting design draw on Chromium Crossbench.

## Initial scope

The first phase focuses on standardized performance testing of Electron itself. Testing arbitrary user applications is outside the initial scope. Scenarios, metric definitions, interfaces, and implementation details will be developed as the project takes shape.
