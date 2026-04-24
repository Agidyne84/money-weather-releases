# OkAlert and YesNoAlert Dialog Forms

## Overview

Two reusable modal dialog forms for displaying messages and capturing Yes/No responses. Both use `OpenArgs` with a `|~|` delimiter to pass parameters.

## Global Variable

```vba
Public g_YesNoResponse As Boolean  ' Located in modVersionCheck (consider moving to modGlobals)
```

---

## OkAlert

Displays a message with an OK button. Use for notifications, warnings, and confirmations.

### OpenArgs Format

```
MessageText|~|FormCaption
```

| Part | Required | Description |
|------|----------|-------------|
| MessageText | Yes | Main message displayed in lblMessage |
| FormCaption | No | Window title (uses default if omitted) |

### Usage

```vba
' With custom title
DoCmd.OpenForm "OkAlert", acNormal, , , , acDialog, "Your message here|~|Window Title"

' Without custom title
DoCmd.OpenForm "OkAlert", acNormal, , , , acDialog, "Your message here"
```

### Examples

```vba
' Validation error
DoCmd.OpenForm "OkAlert", acNormal, , , , acDialog, _
    "Please enter a customer name before saving.|~|Missing Information"

' Success confirmation
DoCmd.OpenForm "OkAlert", acNormal, , , , acDialog, _
    "Record saved successfully.|~|Success"

' Warning
DoCmd.OpenForm "OkAlert", acNormal, , , , acDialog, _
    "This report may take several minutes to generate.|~|Please Wait"
```

---

## YesNoAlert

Displays a message with Yes and No buttons. Use for confirmations and decisions.

### OpenArgs Format

```
MessageText|~|MessageText2|~|FormCaption
```

| Part | Required | Description |
|------|----------|-------------|
| MessageText | Yes | Primary message displayed in lblMessage |
| MessageText2 | No | Secondary message displayed in lblMessage2 |
| FormCaption | No | Window title (uses default if omitted) |

### Response

Check `g_YesNoResponse` immediately after the form closes:
- `True` = User clicked Yes
- `False` = User clicked No

### Usage

```vba
' Full usage with all parameters
DoCmd.OpenForm "YesNoAlert", acNormal, , , , acDialog, _
    "Primary message|~|Secondary message|~|Window Title"

If g_YesNoResponse Then
    ' User clicked Yes
Else
    ' User clicked No
End If
```

### Examples

```vba
' Confirm delete
DoCmd.OpenForm "YesNoAlert", acNormal, , , , acDialog, _
    "Are you sure you want to delete this record?|~|This action cannot be undone.|~|Confirm Delete"

If g_YesNoResponse Then
    CurrentDb.Execute "DELETE FROM Customers WHERE CustomerID = " & lngID
End If

' Confirm navigation with unsaved changes
DoCmd.OpenForm "YesNoAlert", acNormal, , , , acDialog, _
    "You have unsaved changes.|~|Do you want to leave without saving?|~|Unsaved Changes"

If g_YesNoResponse Then
    Me.Undo
    DoCmd.Close acForm, Me.Name
End If

' Confirm batch operation
DoCmd.OpenForm "YesNoAlert", acNormal, , , , acDialog, _
    "This will update " & lngCount & " records.|~|Continue?|~|Batch Update"

If g_YesNoResponse Then
    Call RunBatchUpdate
End If
```

---

## Form Controls Reference

### OkAlert
| Control | Type | Purpose |
|---------|------|---------|
| lblMessage | Label | Displays MessageText |
| cmdOk | Button | Closes form |

### YesNoAlert
| Control | Type | Purpose |
|---------|------|---------|
| lblMessage | Label | Displays MessageText |
| lblMessage2 | Label | Displays MessageText2 |
| cmdYes | Button | Sets g_YesNoResponse = True, closes form |
| cmdNo | Button | Sets g_YesNoResponse = False, closes form |

---

## Notes

- Both forms open as `acDialog`, which halts code execution until closed
- The `|~|` delimiter was chosen to avoid conflicts with common text characters
- `g_YesNoResponse` should be checked immediately after the form closes
- Consider moving `g_YesNoResponse` to a general module like `modGlobals` for cleaner organization
