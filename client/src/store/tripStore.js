import { create } from 'zustand'
import { tripsApi, daysApi, placesApi, assignmentsApi, packingApi, tagsApi, categoriesApi, budgetApi, filesApi, reservationsApi, dayNotesApi } from '../api/client'

export const useTripStore = create((set, get) => ({
  trip: null,
  days: [],
  places: [],
  assignments: {},    // { [dayId]: [assignment objects] }
  dayNotes: {},       // { [dayId]: [note objects] }
  packingItems: [],
  tags: [],
  categories: [],
  budgetItems: [],
  files: [],
  reservations: [],
  selectedDayId: null,
  isLoading: false,
  error: null,

  setSelectedDay: (dayId) => set({ selectedDayId: dayId }),

  // Handle remote WebSocket events without making API calls
  handleRemoteEvent: (event) => {
    const { type, ...payload } = event

    set(state => {
      switch (type) {
        // Places
        case 'place:created':
          if (state.places.some(p => p.id === payload.place.id)) return {}
          return { places: [payload.place, ...state.places] }
        case 'place:updated':
          return {
            places: state.places.map(p => p.id === payload.place.id ? payload.place : p),
            assignments: Object.fromEntries(
              Object.entries(state.assignments).map(([dayId, items]) => [
                dayId,
                items.map(a => a.place?.id === payload.place.id ? { ...a, place: payload.place } : a)
              ])
            ),
          }
        case 'place:deleted':
          return {
            places: state.places.filter(p => p.id !== payload.placeId),
            assignments: Object.fromEntries(
              Object.entries(state.assignments).map(([dayId, items]) => [
                dayId,
                items.filter(a => a.place?.id !== payload.placeId)
              ])
            ),
          }

        // Assignments
        case 'assignment:created': {
          const dayKey = String(payload.assignment.day_id)
          const existing = (state.assignments[dayKey] || [])
          // Skip if already present (by id OR by place_id to handle optimistic temp ids)
          const placeId = payload.assignment.place?.id || payload.assignment.place_id
          if (existing.some(a => a.id === payload.assignment.id || (placeId && a.place?.id === placeId))) {
            // Replace temp entry with server version if needed
            const hasTempVersion = existing.some(a => a.id < 0 && a.place?.id === placeId)
            if (hasTempVersion) {
              return {
                assignments: {
                  ...state.assignments,
                  [dayKey]: existing.map(a => (a.id < 0 && a.place?.id === placeId) ? payload.assignment : a),
                }
              }
            }
            return {}
          }
          return {
            assignments: {
              ...state.assignments,
              [dayKey]: [...existing, payload.assignment],
            }
          }
        }
        case 'assignment:updated': {
          const dayKey = String(payload.assignment.day_id)
          return {
            assignments: {
              ...state.assignments,
              [dayKey]: (state.assignments[dayKey] || []).map(a =>
                a.id === payload.assignment.id ? { ...a, ...payload.assignment } : a
              ),
            }
          }
        }
        case 'assignment:deleted': {
          const dayKey = String(payload.dayId)
          return {
            assignments: {
              ...state.assignments,
              [dayKey]: (state.assignments[dayKey] || []).filter(a => a.id !== payload.assignmentId),
            }
          }
        }
        case 'assignment:moved': {
          const oldKey = String(payload.oldDayId)
          const newKey = String(payload.newDayId)
          const movedAssignment = payload.assignment
          return {
            assignments: {
              ...state.assignments,
              [oldKey]: (state.assignments[oldKey] || []).filter(a => a.id !== movedAssignment.id),
              [newKey]: [...(state.assignments[newKey] || []).filter(a => a.id !== movedAssignment.id), movedAssignment],
            }
          }
        }
        case 'assignment:reordered': {
          const dayKey = String(payload.dayId)
          const currentItems = state.assignments[dayKey] || []
          const orderedIds = payload.orderedIds || []
          const reordered = orderedIds.map((id, idx) => {
            const item = currentItems.find(a => a.id === id)
            return item ? { ...item, order_index: idx } : null
          }).filter(Boolean)
          return {
            assignments: {
              ...state.assignments,
              [dayKey]: reordered,
            }
          }
        }

        // Days
        case 'day:created':
          if (state.days.some(d => d.id === payload.day.id)) return {}
          return { days: [...state.days, payload.day] }
        case 'day:updated':
          return {
            days: state.days.map(d => d.id === payload.day.id ? payload.day : d),
          }
        case 'day:deleted': {
          const removedDayId = String(payload.dayId)
          const newAssignments = { ...state.assignments }
          delete newAssignments[removedDayId]
          const newDayNotes = { ...state.dayNotes }
          delete newDayNotes[removedDayId]
          return {
            days: state.days.filter(d => d.id !== payload.dayId),
            assignments: newAssignments,
            dayNotes: newDayNotes,
          }
        }

        // Day Notes
        case 'dayNote:created': {
          const dayKey = String(payload.dayId)
          const existingNotes = (state.dayNotes[dayKey] || [])
          if (existingNotes.some(n => n.id === payload.note.id)) return {}
          return {
            dayNotes: {
              ...state.dayNotes,
              [dayKey]: [...existingNotes, payload.note],
            }
          }
        }
        case 'dayNote:updated': {
          const dayKey = String(payload.dayId)
          return {
            dayNotes: {
              ...state.dayNotes,
              [dayKey]: (state.dayNotes[dayKey] || []).map(n => n.id === payload.note.id ? payload.note : n),
            }
          }
        }
        case 'dayNote:deleted': {
          const dayKey = String(payload.dayId)
          return {
            dayNotes: {
              ...state.dayNotes,
              [dayKey]: (state.dayNotes[dayKey] || []).filter(n => n.id !== payload.noteId),
            }
          }
        }

        // Packing
        case 'packing:created':
          if (state.packingItems.some(i => i.id === payload.item.id)) return {}
          return { packingItems: [...state.packingItems, payload.item] }
        case 'packing:updated':
          return {
            packingItems: state.packingItems.map(i => i.id === payload.item.id ? payload.item : i),
          }
        case 'packing:deleted':
          return {
            packingItems: state.packingItems.filter(i => i.id !== payload.itemId),
          }

        // Budget
        case 'budget:created':
          if (state.budgetItems.some(i => i.id === payload.item.id)) return {}
          return { budgetItems: [...state.budgetItems, payload.item] }
        case 'budget:updated':
          return {
            budgetItems: state.budgetItems.map(i => i.id === payload.item.id ? payload.item : i),
          }
        case 'budget:deleted':
          return {
            budgetItems: state.budgetItems.filter(i => i.id !== payload.itemId),
          }
        case 'budget:members-updated':
          return {
            budgetItems: state.budgetItems.map(i =>
              i.id === payload.itemId ? { ...i, members: payload.members, persons: payload.persons } : i
            ),
          }
        case 'budget:member-paid-updated':
          return {
            budgetItems: state.budgetItems.map(i =>
              i.id === payload.itemId
                ? { ...i, members: (i.members || []).map(m => m.user_id === payload.userId ? { ...m, paid: payload.paid } : m) }
                : i
            ),
          }

        // Reservations
        case 'reservation:created':
          if (state.reservations.some(r => r.id === payload.reservation.id)) return {}
          return { reservations: [payload.reservation, ...state.reservations] }
        case 'reservation:updated':
          return {
            reservations: state.reservations.map(r => r.id === payload.reservation.id ? payload.reservation : r),
          }
        case 'reservation:deleted':
          return {
            reservations: state.reservations.filter(r => r.id !== payload.reservationId),
          }

        // Trip
        case 'trip:updated':
          return { trip: payload.trip }

        // Files
        case 'file:created':
          if (state.files.some(f => f.id === payload.file.id)) return {}
          return { files: [payload.file, ...state.files] }
        case 'file:updated':
          return {
            files: state.files.map(f => f.id === payload.file.id ? payload.file : f),
          }
        case 'file:deleted':
          return {
            files: state.files.filter(f => f.id !== payload.fileId),
          }

        default:
          return {}
      }
    })
  },

  // Load everything for a trip
  loadTrip: async (tripId) => {
    set({ isLoading: true, error: null })
    try {
      const [tripData, daysData, placesData, packingData, tagsData, categoriesData] = await Promise.all([
        tripsApi.get(tripId),
        daysApi.list(tripId),
        placesApi.list(tripId),
        packingApi.list(tripId),
        tagsApi.list(),
        categoriesApi.list(),
      ])

      const assignmentsMap = {}
      const dayNotesMap = {}
      for (const day of daysData.days) {
        assignmentsMap[String(day.id)] = day.assignments || []
        dayNotesMap[String(day.id)] = day.notes_items || []
      }

      set({
        trip: tripData.trip,
        days: daysData.days,
        places: placesData.places,
        assignments: assignmentsMap,
        dayNotes: dayNotesMap,
        packingItems: packingData.items,
        tags: tagsData.tags,
        categories: categoriesData.categories,
        isLoading: false,
      })
    } catch (err) {
      set({ isLoading: false, error: err.message })
      throw err
    }
  },

  refreshDays: async (tripId) => {
    try {
      const daysData = await daysApi.list(tripId)
      const assignmentsMap = {}
      const dayNotesMap = {}
      for (const day of daysData.days) {
        assignmentsMap[String(day.id)] = day.assignments || []
        dayNotesMap[String(day.id)] = day.notes_items || []
      }
      set({ days: daysData.days, assignments: assignmentsMap, dayNotes: dayNotesMap })
    } catch (err) {
      console.error('Failed to refresh days:', err)
    }
  },

  refreshPlaces: async (tripId) => {
    try {
      const data = await placesApi.list(tripId)
      set({ places: data.places })
    } catch (err) {
      console.error('Failed to refresh places:', err)
    }
  },

  addPlace: async (tripId, placeData) => {
    try {
      const data = await placesApi.create(tripId, placeData)
      set(state => ({ places: [data.place, ...state.places] }))
      return data.place
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error adding place')
    }
  },

  updatePlace: async (tripId, placeId, placeData) => {
    try {
      const data = await placesApi.update(tripId, placeId, placeData)
      set(state => ({
        places: state.places.map(p => p.id === placeId ? data.place : p),
        assignments: Object.fromEntries(
          Object.entries(state.assignments).map(([dayId, items]) => [
            dayId,
            items.map(a => a.place?.id === placeId ? { ...a, place: { ...data.place, place_time: a.place.place_time, end_time: a.place.end_time } } : a)
          ])
        ),
      }))
      return data.place
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating place')
    }
  },

  deletePlace: async (tripId, placeId) => {
    try {
      await placesApi.delete(tripId, placeId)
      set(state => ({
        places: state.places.filter(p => p.id !== placeId),
        assignments: Object.fromEntries(
          Object.entries(state.assignments).map(([dayId, items]) => [
            dayId,
            items.filter(a => a.place?.id !== placeId)
          ])
        ),
      }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error deleting place')
    }
  },

  assignPlaceToDay: async (tripId, dayId, placeId, position) => {
    const state = get()
    const place = state.places.find(p => p.id === parseInt(placeId))
    if (!place) return

    const tempId = Date.now() * -1
    const current = [...(state.assignments[String(dayId)] || [])]
    const insertIdx = position != null ? position : current.length
    const tempAssignment = {
      id: tempId,
      day_id: parseInt(dayId),
      order_index: insertIdx,
      notes: null,
      place,
    }

    current.splice(insertIdx, 0, tempAssignment)
    set(state => ({
      assignments: {
        ...state.assignments,
        [String(dayId)]: current,
      }
    }))

    try {
      const data = await assignmentsApi.create(tripId, dayId, { place_id: placeId })
      const newAssignment = {
        ...data.assignment,
        place: data.assignment.place || place,
        order_index: position != null ? insertIdx : data.assignment.order_index,
      }
      set(state => ({
        assignments: {
          ...state.assignments,
          [String(dayId)]: state.assignments[String(dayId)].map(
            a => a.id === tempId ? newAssignment : a
          ),
        }
      }))
      // Reihenfolge am Server aktualisieren und lokalen State mit Server-Antwort synchronisieren
      if (position != null) {
        const updated = get().assignments[String(dayId)] || []
        const orderedIds = updated.map(a => a.id).filter(id => id > 0)
        if (orderedIds.length > 0) {
          try {
            await assignmentsApi.reorder(tripId, dayId, orderedIds)
            // Lokalen State auf die gesendete Reihenfolge setzen
            set(state => {
              const items = state.assignments[String(dayId)] || []
              const reordered = orderedIds.map((id, idx) => {
                const item = items.find(a => a.id === id)
                return item ? { ...item, order_index: idx } : null
              }).filter(Boolean)
              return {
                assignments: {
                  ...state.assignments,
                  [String(dayId)]: reordered,
                }
              }
            })
          } catch {}
        }
      }
      return data.assignment
    } catch (err) {
      set(state => ({
        assignments: {
          ...state.assignments,
          [String(dayId)]: state.assignments[String(dayId)].filter(a => a.id !== tempId),
        }
      }))
      throw new Error(err.response?.data?.error || 'Error assigning place')
    }
  },

  removeAssignment: async (tripId, dayId, assignmentId) => {
    const prevAssignments = get().assignments

    set(state => ({
      assignments: {
        ...state.assignments,
        [String(dayId)]: state.assignments[String(dayId)].filter(a => a.id !== assignmentId),
      }
    }))

    try {
      await assignmentsApi.delete(tripId, dayId, assignmentId)
    } catch (err) {
      set({ assignments: prevAssignments })
      throw new Error(err.response?.data?.error || 'Error removing assignment')
    }
  },

  reorderAssignments: async (tripId, dayId, orderedIds) => {
    const prevAssignments = get().assignments
    const dayItems = get().assignments[String(dayId)] || []
    const reordered = orderedIds.map((id, idx) => {
      const item = dayItems.find(a => a.id === id)
      return item ? { ...item, order_index: idx } : null
    }).filter(Boolean)

    set(state => ({
      assignments: {
        ...state.assignments,
        [String(dayId)]: reordered,
      }
    }))

    try {
      await assignmentsApi.reorder(tripId, dayId, orderedIds)
    } catch (err) {
      set({ assignments: prevAssignments })
      throw new Error(err.response?.data?.error || 'Error reordering')
    }
  },

  moveAssignment: async (tripId, assignmentId, fromDayId, toDayId, toOrderIndex = null) => {
    const state = get()
    const prevAssignments = state.assignments
    const assignment = (state.assignments[String(fromDayId)] || []).find(a => a.id === assignmentId)
    if (!assignment) return

    const toItems = (state.assignments[String(toDayId)] || []).slice().sort((a, b) => a.order_index - b.order_index)
    const insertAt = toOrderIndex !== null ? toOrderIndex : toItems.length

    // Build new order for target day with item inserted at correct position
    const newToItems = [...toItems]
    newToItems.splice(insertAt, 0, { ...assignment, day_id: parseInt(toDayId) })
    newToItems.forEach((a, i) => { a.order_index = i })

    set(s => ({
      assignments: {
        ...s.assignments,
        [String(fromDayId)]: s.assignments[String(fromDayId)].filter(a => a.id !== assignmentId),
        [String(toDayId)]: newToItems,
      }
    }))

    try {
      await assignmentsApi.move(tripId, assignmentId, toDayId, insertAt)
      if (newToItems.length > 1) {
        await assignmentsApi.reorder(tripId, toDayId, newToItems.map(a => a.id))
      }
    } catch (err) {
      set({ assignments: prevAssignments })
      throw new Error(err.response?.data?.error || 'Error moving assignment')
    }
  },

  moveDayNote: async (tripId, fromDayId, toDayId, noteId, sort_order = 9999) => {
    const state = get()
    const note = (state.dayNotes[String(fromDayId)] || []).find(n => n.id === noteId)
    if (!note) return

    set(s => ({
      dayNotes: {
        ...s.dayNotes,
        [String(fromDayId)]: (s.dayNotes[String(fromDayId)] || []).filter(n => n.id !== noteId),
      }
    }))

    try {
      await dayNotesApi.delete(tripId, fromDayId, noteId)
      const result = await dayNotesApi.create(tripId, toDayId, {
        text: note.text, time: note.time, icon: note.icon, sort_order,
      })
      set(s => ({
        dayNotes: {
          ...s.dayNotes,
          [String(toDayId)]: [...(s.dayNotes[String(toDayId)] || []), result.note],
        }
      }))
    } catch (err) {
      set(s => ({
        dayNotes: {
          ...s.dayNotes,
          [String(fromDayId)]: [...(s.dayNotes[String(fromDayId)] || []), note],
        }
      }))
      throw new Error(err.response?.data?.error || 'Error moving note')
    }
  },

  setAssignments: (assignments) => {
    set({ assignments })
  },

  addPackingItem: async (tripId, data) => {
    try {
      const result = await packingApi.create(tripId, data)
      set(state => ({ packingItems: [...state.packingItems, result.item] }))
      return result.item
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error adding item')
    }
  },

  updatePackingItem: async (tripId, id, data) => {
    try {
      const result = await packingApi.update(tripId, id, data)
      set(state => ({
        packingItems: state.packingItems.map(item => item.id === id ? result.item : item)
      }))
      return result.item
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating item')
    }
  },

  deletePackingItem: async (tripId, id) => {
    const prev = get().packingItems
    set(state => ({ packingItems: state.packingItems.filter(item => item.id !== id) }))
    try {
      await packingApi.delete(tripId, id)
    } catch (err) {
      set({ packingItems: prev })
      throw new Error(err.response?.data?.error || 'Error deleting item')
    }
  },

  togglePackingItem: async (tripId, id, checked) => {
    set(state => ({
      packingItems: state.packingItems.map(item =>
        item.id === id ? { ...item, checked: checked ? 1 : 0 } : item
      )
    }))
    try {
      await packingApi.update(tripId, id, { checked })
    } catch (err) {
      set(state => ({
        packingItems: state.packingItems.map(item =>
          item.id === id ? { ...item, checked: checked ? 0 : 1 } : item
        )
      }))
    }
  },

  updateDayNotes: async (tripId, dayId, notes) => {
    try {
      await daysApi.update(tripId, dayId, { notes })
      set(state => ({
        days: state.days.map(d => d.id === parseInt(dayId) ? { ...d, notes } : d)
      }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating notes')
    }
  },

  updateDayTitle: async (tripId, dayId, title) => {
    try {
      await daysApi.update(tripId, dayId, { title })
      set(state => ({
        days: state.days.map(d => d.id === parseInt(dayId) ? { ...d, title } : d)
      }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating day name')
    }
  },

  addTag: async (data) => {
    try {
      const result = await tagsApi.create(data)
      set(state => ({ tags: [...state.tags, result.tag] }))
      return result.tag
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error creating tag')
    }
  },

  addCategory: async (data) => {
    try {
      const result = await categoriesApi.create(data)
      set(state => ({ categories: [...state.categories, result.category] }))
      return result.category
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error creating category')
    }
  },

  updateTrip: async (tripId, data) => {
    try {
      const result = await tripsApi.update(tripId, data)
      set({ trip: result.trip })
      const daysData = await daysApi.list(tripId)
      const assignmentsMap = {}
      const dayNotesMap = {}
      for (const day of daysData.days) {
        assignmentsMap[String(day.id)] = day.assignments || []
        dayNotesMap[String(day.id)] = day.notes_items || []
      }
      set({ days: daysData.days, assignments: assignmentsMap, dayNotes: dayNotesMap })
      return result.trip
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating trip')
    }
  },

  loadBudgetItems: async (tripId) => {
    try {
      // Create any missing placeholders before reading the current budget list.
      await budgetApi.syncPlaceholders(tripId).catch(() => null)
      const data = await budgetApi.list(tripId)
      set({ budgetItems: data.items })
    } catch (err) {
      console.error('Failed to load budget items:', err)
    }
  },

  addBudgetItem: async (tripId, data) => {
    try {
      const result = await budgetApi.create(tripId, data)
      set(state => ({ budgetItems: [...state.budgetItems, result.item] }))
      return result.item
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error adding budget item')
    }
  },

  updateBudgetItem: async (tripId, id, data) => {
    try {
      const result = await budgetApi.update(tripId, id, data)
      set(state => ({
        budgetItems: state.budgetItems.map(item => item.id === id ? result.item : item)
      }))
      return result.item
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating budget item')
    }
  },

  deleteBudgetItem: async (tripId, id) => {
    const prev = get().budgetItems
    set(state => ({ budgetItems: state.budgetItems.filter(item => item.id !== id) }))
    try {
      await budgetApi.delete(tripId, id)
    } catch (err) {
      set({ budgetItems: prev })
      throw new Error(err.response?.data?.error || 'Error deleting budget item')
    }
  },

  setBudgetItemMembers: async (tripId, itemId, userIds) => {
    const result = await budgetApi.setMembers(tripId, itemId, userIds);
    set(state => ({
      budgetItems: state.budgetItems.map(item =>
        item.id === itemId ? { ...item, members: result.members, persons: result.item.persons } : item
      )
    }));
    return result;
  },

  toggleBudgetMemberPaid: async (tripId, itemId, userId, paid) => {
    await budgetApi.togglePaid(tripId, itemId, userId, paid);
    set(state => ({
      budgetItems: state.budgetItems.map(item =>
        item.id === itemId
          ? { ...item, members: (item.members || []).map(m => m.user_id === userId ? { ...m, paid } : m) }
          : item
      )
    }));
  },

  loadFiles: async (tripId) => {
    try {
      const data = await filesApi.list(tripId)
      set({ files: data.files })
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  },

  addFile: async (tripId, formData) => {
    try {
      const data = await filesApi.upload(tripId, formData)
      set(state => ({ files: [data.file, ...state.files] }))
      return data.file
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error uploading file')
    }
  },

  deleteFile: async (tripId, id) => {
    try {
      await filesApi.delete(tripId, id)
      set(state => ({ files: state.files.filter(f => f.id !== id) }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error deleting file')
    }
  },

  loadReservations: async (tripId) => {
    try {
      const data = await reservationsApi.list(tripId)
      set({ reservations: data.reservations })
    } catch (err) {
      console.error('Failed to load reservations:', err)
    }
  },

  addReservation: async (tripId, data) => {
    try {
      const result = await reservationsApi.create(tripId, data)
      set(state => ({ reservations: [result.reservation, ...state.reservations] }))
      return result.reservation
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error creating reservation')
    }
  },

  updateReservation: async (tripId, id, data) => {
    try {
      const result = await reservationsApi.update(tripId, id, data)
      set(state => ({
        reservations: state.reservations.map(r => r.id === id ? result.reservation : r)
      }))
      return result.reservation
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating reservation')
    }
  },

  toggleReservationStatus: async (tripId, id) => {
    const prev = get().reservations
    const current = prev.find(r => r.id === id)
    if (!current) return
    const newStatus = current.status === 'confirmed' ? 'pending' : 'confirmed'
    set(state => ({
      reservations: state.reservations.map(r => r.id === id ? { ...r, status: newStatus } : r)
    }))
    try {
      await reservationsApi.update(tripId, id, { status: newStatus })
    } catch {
      set({ reservations: prev })
    }
  },

  deleteReservation: async (tripId, id) => {
    try {
      await reservationsApi.delete(tripId, id)
      set(state => ({ reservations: state.reservations.filter(r => r.id !== id) }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error deleting reservation')
    }
  },

  addDayNote: async (tripId, dayId, data) => {
    const tempId = Date.now() * -1
    const tempNote = { id: tempId, day_id: dayId, ...data, created_at: new Date().toISOString() }
    set(state => ({
      dayNotes: {
        ...state.dayNotes,
        [String(dayId)]: [...(state.dayNotes[String(dayId)] || []), tempNote],
      }
    }))
    try {
      const result = await dayNotesApi.create(tripId, dayId, data)
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: (state.dayNotes[String(dayId)] || []).map(n => n.id === tempId ? result.note : n),
        }
      }))
      return result.note
    } catch (err) {
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: (state.dayNotes[String(dayId)] || []).filter(n => n.id !== tempId),
        }
      }))
      throw new Error(err.response?.data?.error || 'Error adding note')
    }
  },

  updateDayNote: async (tripId, dayId, id, data) => {
    try {
      const result = await dayNotesApi.update(tripId, dayId, id, data)
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: (state.dayNotes[String(dayId)] || []).map(n => n.id === id ? result.note : n),
        }
      }))
      return result.note
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating note')
    }
  },

  deleteDayNote: async (tripId, dayId, id) => {
    const prev = get().dayNotes
    set(state => ({
      dayNotes: {
        ...state.dayNotes,
        [String(dayId)]: (state.dayNotes[String(dayId)] || []).filter(n => n.id !== id),
      }
    }))
    try {
      await dayNotesApi.delete(tripId, dayId, id)
    } catch (err) {
      set({ dayNotes: prev })
      throw new Error(err.response?.data?.error || 'Error deleting note')
    }
  },
}))
