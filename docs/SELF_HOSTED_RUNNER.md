# Self-hosted GitHub Actions runner

This repository’s CI workflow uses `runs-on: self-hosted` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). A runner only needs the default `self-hosted` label to pick up the current jobs.

Use a self-hosted runner when you want CI for this repo to run on your own machine, or when a workflow sits in the queue and you need to check whether the runner is registered, online, and matched to the job.

## Security warning / accepted threat model

Self-hosted runners are not disposable GitHub-hosted virtual machines. Workflows execute code on the runner host, so a malicious or compromised workflow can potentially persist on that machine, read files available to the runner user, or tamper with later jobs. GitHub's secure-use guidance warns that self-hosted runners should be used with extra care, especially for public repositories or pull requests from untrusted forks: <https://docs.github.com/en/actions/reference/security/secure-use>.

For this repo, using a self-hosted runner is acceptable only under this threat model:

- The repository is private, and pull requests are from trusted collaborators/agents.
- Do **not** run self-hosted PR jobs from untrusted forks on a personal workstation.
- Prefer GitHub-hosted runners for public repositories unless there is a deliberate reason not to.
- Run the runner on an isolated or disposable VM/container/host when possible, not on a machine with unrelated secrets or personal data.
- Do not place long-lived cloud/API credentials in the runner environment.
- Keep workflow `permissions` minimal; this repo currently uses `contents: read`, which limits `GITHUB_TOKEN` but does not protect the runner host itself.
- Recreate or clean the runner if a workflow from an untrusted source ever executes on it.

## 1) Register the runner

The commands below register the runner against this repository and install the current GitHub Actions runner release for your OS and CPU.

```bash
REPO="Pastorsimon1798/achiote"

TOKEN="$(gh api --method POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
TAG="$(gh api repos/actions/runner/releases/latest --jq .tag_name)"

OS="$(uname -s)"
case "$OS" in
  Linux) OS=linux ;;
  Darwin) OS=osx ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

mkdir -p "$HOME/actions-runner/$REPO"
cd "$HOME/actions-runner/$REPO"

curl -L -o actions-runner.tar.gz \
  "https://github.com/actions/runner/releases/download/$TAG/actions-runner-$OS-$ARCH-${TAG#v}.tar.gz"
tar xzf actions-runner.tar.gz

./config.sh \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$(hostname)-achiote"
```

Optional: add a custom label during configuration if you want to target this runner from future workflows.

```bash
./config.sh \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$(hostname)-achiote" \
  --labels achiote
```

## 2) Run it as a service

After configuration, install and start the service from the runner directory. GitHub creates `svc.sh` after `./config.sh` succeeds; if the file is missing, finish configuration first.

### Linux

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

### macOS

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

## 3) Verify that GitHub can see it

Check the repository runner inventory with the GitHub API:

```bash
gh api repos/Pastorsimon1798/achiote/actions/runners \
  --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}'
```

For a quick count:

```bash
gh api repos/Pastorsimon1798/achiote/actions/runners --jq .total_count
```

If the runner is registered correctly, you should see:

- `status: "online"`
- `busy: false` when it is idle
- `self-hosted` in the label list

## 4) Check queued jobs

List queued workflow runs for this repository:

```bash
gh run list --repo Pastorsimon1798/achiote --status queued --limit 10
```

If a job stays queued, compare these three things:

1. The workflow’s `runs-on` value in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
2. The runner labels returned by `gh api .../actions/runners`
3. The runner service status from `./svc.sh status`

For this repo, the current workflow only requires `self-hosted`. A label mismatch becomes a problem only if you add more labels later.

## 5) Common queue causes

- No runner is registered for the repo.
- The runner exists, but `status` is not `online`.
- The runner service is stopped or failing.
- The workflow asks for a label that the runner does not have.
- The runner is busy with another job.

## 6) Fast recovery checklist

```bash
gh api repos/Pastorsimon1798/achiote/actions/runners --jq .total_count
gh run list --repo Pastorsimon1798/achiote --status queued --limit 10
./svc.sh status
```

