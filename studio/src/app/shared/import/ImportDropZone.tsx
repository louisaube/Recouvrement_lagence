import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Box, Button, Typography } from '@mui/material'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

interface Props {
  disabled: boolean
  accept: string
  /** The first file given, and whether more than one was given. */
  onFile: (file: File, extra: boolean) => void
}

/** Dashed drop area with a hidden file field; the field is reset after each choice. */
export function ImportDropZone({ disabled, accept, onFile }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const stop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const onDrop = (e: DragEvent) => {
    stop(e)
    setOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFile(files[0], files.length > 1)
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) onFile(files[0], files.length > 1)
  }

  return (
    <Box
      onDragEnter={(e) => {
        stop(e)
        if (!disabled) setOver(true)
      }}
      onDragOver={(e) => {
        stop(e)
        if (!disabled) setOver(true)
      }}
      onDragLeave={(e) => {
        stop(e)
        setOver(false)
      }}
      onDrop={onDrop}
      sx={{
        minHeight: 160,
        border: '2px dashed',
        borderColor: over ? 'primary.main' : 'divider',
        bgcolor: over ? 'action.hover' : disabled ? 'action.disabledBackground' : 'transparent',
        opacity: disabled ? 0.6 : 1,
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 3,
        textAlign: 'center',
      }}
    >
      <InsertDriveFileOutlinedIcon fontSize="large" color="action" />
      <Typography>Glissez un fichier .xlsx ou .csv ici</Typography>
      <Button variant="outlined" disabled={disabled} onClick={() => input.current?.click()}>
        Choisir un fichier
      </Button>
      <input ref={input} type="file" hidden accept={accept} aria-label="Fichier à importer" disabled={disabled} onChange={onChange} />
    </Box>
  )
}
