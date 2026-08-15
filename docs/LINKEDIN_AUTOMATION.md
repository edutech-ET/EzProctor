# EzProctor LinkedIn Campaign Automation

The daily workflow creates two branded infographic posts for the EzProctor LinkedIn organization:

- Organization ID: `14490214`
- Organization URN: `urn:li:organization:14490214`
- Schedule: `12:00 PM Australia/Perth (AWST)` every day
- Output: one educator pain-point post and one EzProctor workflow post

The workflow always saves its images, captions and manifest as a GitHub Actions artifact for 30 days. Automatic publishing is disabled until the authorization steps below are complete.

## LinkedIn authorization

1. Create or use a LinkedIn Developer application associated with the EzProctor company page.
2. Request access to LinkedIn's Community Management/Posts APIs and the `w_organization_social` permission.
3. Authorize a LinkedIn member who is an EzProctor page administrator or content administrator.
4. In the GitHub repository, add the authorized token as an Actions secret named `LINKEDIN_ACCESS_TOKEN`.
5. Add an Actions variable named `LINKEDIN_PUBLISH_ENABLED` with the value `true`.
6. Optionally add `LINKEDIN_API_VERSION` when LinkedIn requires a specific supported version, in `YYYYMM` format. Without it, the publisher uses the previous calendar month.

Do not commit an access token to this repository. Rotate or refresh the secret according to the token lifetime issued by LinkedIn.

## Preview before activation

Run **EzProctor daily LinkedIn campaign** from the GitHub Actions page with **Publish both posts to LinkedIn** left disabled. Download the generated artifact to review both images and captions.

For a local preview:

```powershell
python scripts/linkedin/generate_campaign.py --date 2026-08-15 --output campaign-output
```

Open `campaign-output/post-1-educator-pain-point.png`, `campaign-output/post-2-ezproctor-workflow.png`, and `campaign-output/manifest.json`.

## Safety controls

- Scheduled publishing runs only when `LINKEDIN_PUBLISH_ENABLED` is exactly `true`.
- The publisher refuses to post to any organization other than `14490214`.
- Access tokens remain in GitHub Actions secrets and are never written to campaign artifacts.
- A manual workflow run defaults to preview-only mode.
- Daily themes rotate deterministically to reduce repeated content.

LinkedIn API references:

- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
