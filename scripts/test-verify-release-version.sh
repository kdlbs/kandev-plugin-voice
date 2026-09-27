#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
verify_script=$repo_dir/scripts/verify-release-version.sh
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
base_version=$(sed -nE 's/^version: "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$repo_dir/manifest.yaml")
wrong_version=999.999.999
[ "$wrong_version" != "$base_version" ] || wrong_version=999.999.998

make_fixture() {
	fixture=$test_dir/$1
	mkdir -p "$fixture"
	cp "$repo_dir/Makefile" "$repo_dir/manifest.yaml" "$fixture/"
}

set_manifest_minimum() {
	fixture=$1
	minimum=$2
	sed "s/^min_kandev_version: \"v0.88.0\"$/min_kandev_version: \"$minimum\"/" \
		"$fixture/manifest.yaml" > "$fixture/manifest.next"
	mv "$fixture/manifest.next" "$fixture/manifest.yaml"
}

expect_failure() {
	name=$1
	fixture=$2
	shift 2
	if (cd "$fixture" && sh "$verify_script" "$@") > "$test_dir/output" 2>&1; then
		printf 'expected release verification to reject %s\n' "$name" >&2
		exit 1
	fi
}

make_fixture valid
(cd "$test_dir/valid" && sh "$verify_script" "v$base_version")

make_fixture unprefixed-minimum
set_manifest_minimum "$test_dir/unprefixed-minimum" 0.88.0
expect_failure 'an unprefixed minimum that old hosts compare unsafely' "$test_dir/unprefixed-minimum" "v$base_version"

make_fixture low-minimum
set_manifest_minimum "$test_dir/low-minimum" v0.87.1
expect_failure 'a minimum below the verified host floor' "$test_dir/low-minimum" "v$base_version"

make_fixture higher-minimum
set_manifest_minimum "$test_dir/higher-minimum" v0.88.1
(cd "$test_dir/higher-minimum" && sh "$verify_script" "v$base_version")

make_fixture wrong-tag
expect_failure 'a tag that differs from manifest.yaml' "$test_dir/wrong-tag" "v$wrong_version"

make_fixture wrong-manifest
sed "s/^version: \"$base_version\"$/version: \"$wrong_version\"/" "$test_dir/wrong-manifest/manifest.yaml" > "$test_dir/wrong-manifest/manifest.next"
mv "$test_dir/wrong-manifest/manifest.next" "$test_dir/wrong-manifest/manifest.yaml"
expect_failure 'a manifest version that differs from the release tag' "$test_dir/wrong-manifest" "v$base_version"

make_fixture wrong-makefile
sed "s/^VERSION := $base_version$/VERSION := $wrong_version/" "$test_dir/wrong-makefile/Makefile" > "$test_dir/wrong-makefile/Makefile.next"
mv "$test_dir/wrong-makefile/Makefile.next" "$test_dir/wrong-makefile/Makefile"
expect_failure 'a Makefile version that differs from manifest.yaml' "$test_dir/wrong-makefile" "v$base_version"

make_fixture wrong-package
mkdir -p "$test_dir/wrong-package/archive"
sed "s/^version: \"$base_version\"$/version: \"$wrong_version\"/" "$test_dir/wrong-package/manifest.yaml" > "$test_dir/wrong-package/archive/manifest.yaml"
package_file=$(cd "$test_dir/wrong-package" && make -s package-file)
tar -czf "$test_dir/wrong-package/$package_file" -C "$test_dir/wrong-package/archive" manifest.yaml
expect_failure 'an archive manifest version that differs from its tag' "$test_dir/wrong-package" "v$base_version" "$package_file"

make_fixture matching-package
mkdir -p "$test_dir/matching-package/archive"
cp "$test_dir/matching-package/manifest.yaml" "$test_dir/matching-package/archive/manifest.yaml"
package_file=$(cd "$test_dir/matching-package" && make -s package-file)
tar -czf "$test_dir/matching-package/$package_file" -C "$test_dir/matching-package/archive" manifest.yaml
(cd "$test_dir/matching-package" && sh "$verify_script" "v$base_version" "$package_file")

make_fixture unprefixed-package-minimum
mkdir -p "$test_dir/unprefixed-package-minimum/archive"
set_manifest_minimum "$test_dir/unprefixed-package-minimum" 0.88.0
cp "$test_dir/unprefixed-package-minimum/manifest.yaml" "$test_dir/unprefixed-package-minimum/archive/manifest.yaml"
package_file=$(cd "$test_dir/unprefixed-package-minimum" && make -s package-file)
tar -czf "$test_dir/unprefixed-package-minimum/$package_file" -C "$test_dir/unprefixed-package-minimum/archive" manifest.yaml
expect_failure 'an archive with an unprefixed minimum' "$test_dir/unprefixed-package-minimum" "v$base_version" "$package_file"

expect_failure 'a non-version release tag' "$test_dir/valid" "release-$base_version"
printf 'release version verifier tests passed\n'
